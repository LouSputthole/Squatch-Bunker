"use client";

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useEffectEvent } from "react";
import { getSocket } from "@/lib/socket";
import { sounds } from "@/lib/sounds";
import { toast } from "@/lib/toast";
import {
  ensureRuntimeConfig,
  invalidateRuntimeConfig,
} from "@/hooks/useRuntimeConfig";
import { effectiveUserVolume } from "@/lib/voiceVolume";
import {
  AUDIO_SETTINGS_STORAGE_KEY,
  MEDIA_DEVICE_SETTINGS_EVENT,
  applyAudioOutputDevice,
  getMediaDeviceSettings,
  readAudioSettings,
  readMediaDeviceSettings,
  reconcileMediaDeviceSettings,
  replaceActiveAudioTrack,
  requestCameraStream,
  requestVoiceStream,
  saveAudioSettings,
  type MediaDeviceSettings,
} from "@/lib/mediaDeviceSettings";

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
  speaking?: boolean;
  camera?: boolean;
  avatar?: string | null;
  /** Set by a moderator; the user cannot unmute/undeafen until it is lifted. */
  serverMuted?: boolean;
  serverDeafened?: boolean;
  connectionQuality?: "good" | "fair" | "poor" | "unknown";
  pingMs?: number;
}

interface OffshootRoute {
  id: string;
  members: { userId: string }[];
}

interface VoicePanelProps {
  channelId: string;
  channelName: string;
  serverId: string;
  currentUserId: string;
  currentUsername: string;
  currentUserAvatar?: string | null;
  /** Push-to-talk, owned by useVoice; survives this panel remounting. */
  pttMode?: boolean;
  onParticipantsChange?: (channelId: string, participants: VoiceParticipant[]) => void;
  onDisconnect?: () => void;
  onStateChange?: (state: { muted: boolean; deafened: boolean; reconnecting: boolean; participants: VoiceParticipant[]; sharing: boolean; cameraOn: boolean; serverMuted: boolean; serverDeafened: boolean }) => void;
  onScreenShareChange?: (shares: ScreenShareInfo[]) => void;
  onVideoStreamsChange?: (streams: Map<string, MediaStream>) => void;
}

export interface ScreenShareInfo {
  userId: string;
  username: string;
  stream: MediaStream;
}

export interface VoicePanelHandle {
  toggleMute: () => void;
  toggleDeafen: () => void;
  disconnect: () => void;
  setPTT: (enabled: boolean) => void;
  isPTT: () => boolean;
  setUserVolume: (userId: string, volume: number) => void;
  setUserRoutingMuted: (userId: string, muted: boolean) => void;
  setInputSensitivity: (threshold: number) => void;
  forceMute: () => void;
  forceDeafen: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  toggleCamera: () => Promise<void>;
  getVideoStreams: () => Map<string, MediaStream>;
  getLocalCameraStream: () => MediaStream | null;
  getLocalScreenStream: () => MediaStream | null;
}

async function getIceServers(): Promise<RTCConfiguration> {
  const servers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  // Add TURN server if configured (needed for voice across NATs/internet)
  const config = await ensureRuntimeConfig();
  const turnUrls = config.turnUrls.length > 0
    ? config.turnUrls
    : config.turnUrl
      ? [config.turnUrl]
      : [];
  if (turnUrls.length > 0 && config.turnUsername && config.turnCredential) {
    servers.push({
      urls: turnUrls,
      username: config.turnUsername,
      credential: config.turnCredential,
    });
  }

  return { iceServers: servers };
}

function clearUnavailableMediaDevice(
  setting: "inputDevice" | "outputDevice" | "videoDevice",
) {
  const settings = readAudioSettings();
  if (!settings[setting]) return;
  saveAudioSettings({ ...settings, [setting]: "" });
}

// Keep "speaking" lit briefly after the level dips so pauses between words
// don't flip the indicator (and emit voice:speaking) every 100ms poll.
const VAD_HANGOVER_MS = 300;

function clampSetting(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, number));
}

interface InputGainPipeline {
  context: AudioContext;
  gain: GainNode;
  raw: MediaStream;
}

/**
 * Applies the saved Input Volume by routing the mic through a GainNode. At
 * 100%, or when audio processing cannot start (e.g. an AudioContext still
 * blocked by autoplay policy on a call restored at page load), the raw mic is
 * sent unchanged so a call is never silent because of this setting.
 */
async function applyInputGain(
  raw: MediaStream,
  volume: number,
): Promise<{ stream: MediaStream; pipeline: InputGainPipeline | null }> {
  if (volume === 1 || typeof AudioContext === "undefined") return { stream: raw, pipeline: null };
  let context: AudioContext | null = null;
  try {
    context = new AudioContext();
    if (context.state !== "running") {
      await Promise.race([
        context.resume(),
        new Promise((resolve) => setTimeout(resolve, 250)),
      ]);
      if ((context.state as AudioContextState) !== "running") throw new Error("AudioContext suspended");
    }
    const gain = context.createGain();
    gain.gain.value = volume;
    const destination = context.createMediaStreamDestination();
    context.createMediaStreamSource(raw).connect(gain).connect(destination);
    return { stream: destination.stream, pipeline: { context, gain, raw } };
  } catch {
    if (context) void context.close().catch(() => {});
    return { stream: raw, pipeline: null };
  }
}

function releaseInputGain(pipeline: InputGainPipeline | null) {
  if (!pipeline) return;
  pipeline.raw.getTracks().forEach((track) => track.stop());
  void pipeline.context.close().catch(() => {});
}


function SettingsIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export { SettingsIcon };

const VoicePanel = forwardRef<VoicePanelHandle, VoicePanelProps>(function VoicePanel({
  channelId,
  serverId,
  currentUserId,
  currentUsername,
  currentUserAvatar,
  pttMode = false,
  onParticipantsChange,
  onDisconnect,
  onScreenShareChange,
  onVideoStreamsChange,
  onStateChange,
}, ref) {
  const [joined, setJoined] = useState(false);
  const joinedRef = useRef(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  // Remote audio created after deafening (late joiners, reconnects) must start muted.
  const deafenedRef = useRef(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [offshootRooms, setOffshootRooms] = useState<OffshootRoute[] | null>(null);

  // Moderator state comes from the authoritative roster, so it also survives
  // rejoin and reconnect.
  const selfParticipant = participants.find((p) => p.userId === currentUserId);
  const selfServerMuted = !!selfParticipant?.serverMuted;
  const selfServerDeafened = !!selfParticipant?.serverDeafened;
  const serverMutedRef = useRef(false);
  useEffect(() => {
    serverMutedRef.current = selfServerMuted || selfServerDeafened;
  }, [selfServerMuted, selfServerDeafened]);

  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());

  type QualityEntry = { quality: "good" | "fair" | "poor" | "unknown"; pingMs?: number };
  const [connectionQualities, setConnectionQualities] = useState<Map<string, QualityEntry>>(new Map());

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const iceRestartingPeersRef = useRef<Set<string>>(new Set());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const joinedChannelRef = useRef<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasSpeakingRef = useRef(false);
  const userVolumesRef = useRef<Map<string, number>>(new Map());
  const routingMutedUsersRef = useRef<Set<string>>(new Set());
  const socketToUserRef = useRef<Map<string, string>>(new Map());
  // Saved Settings > Voice levels; applied on mount and whenever they change.
  const vadThresholdRef = useRef(15);
  const outputVolumeRef = useRef(1);
  const inputVolumeRef = useRef(1);
  const inputGainRef = useRef<InputGainPipeline | null>(null);
  const autoRoutedUsersRef = useRef<Set<string>>(new Set());
  const mediaDeviceSettingsRef = useRef<MediaDeviceSettings>({
    inputDevice: "",
    outputDevice: "",
    videoDevice: "",
  });
  const microphoneChangeIdRef = useRef(0);
  const microphoneChangeQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Screen share state
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenPeersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const incomingScreensRef = useRef<Map<string, ScreenShareInfo>>(new Map());
  const [incomingScreens, setIncomingScreens] = useState<ScreenShareInfo[]>([]);

  // Camera state
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const videoSendersRef = useRef<Map<string, RTCRtpSender>>(new Map());
  const remoteVideoStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Map<string, MediaStream>>(new Map());

  const cleanupPeers = useCallback(() => {
    reconnectTimersRef.current.forEach((timer) => clearTimeout(timer));
    reconnectTimersRef.current.clear();
    iceRestartingPeersRef.current.clear();
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    audioElementsRef.current.forEach((el) => { el.srcObject = null; el.remove(); });
    audioElementsRef.current.clear();
  }, []);

  // Per-user volume x routing (side fires) x saved Output Volume. Media
  // elements cap at 1.0, so Output Volume above 100% plays at 100%.
  const applyRemoteVolume = useCallback((audio: HTMLAudioElement, userId?: string) => {
    const preferred = userId
      ? effectiveUserVolume(userVolumesRef.current.get(userId), routingMutedUsersRef.current.has(userId))
      : 1;
    audio.volume = Math.max(0, Math.min(1, preferred * outputVolumeRef.current));
  }, []);

  const applyUserVolumes = useCallback((userId: string) => {
    for (const [socketId, uid] of socketToUserRef.current) {
      if (uid !== userId) continue;
      const audio = audioElementsRef.current.get(socketId);
      if (audio) applyRemoteVolume(audio, uid);
    }
  }, [applyRemoteVolume]);

  const applyRoutingMuted = useCallback((userId: string, routingMuted: boolean) => {
    if (routingMuted) routingMutedUsersRef.current.add(userId);
    else routingMutedUsersRef.current.delete(userId);
    applyUserVolumes(userId);
  }, [applyUserVolumes]);

  const startVAD = useCallback((stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const socket = getSocket();
      let lastLoudAt = -Infinity;

      vadIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const now = performance.now();
        if (avg > vadThresholdRef.current) lastLoudAt = now;
        const isSpeaking = now - lastLoudAt < VAD_HANGOVER_MS;

        if (isSpeaking !== wasSpeakingRef.current) {
          wasSpeakingRef.current = isSpeaking;
          socket.emit("voice:speaking", { channelId, speaking: isSpeaking });
          setSpeakingUsers((prev) => {
            const next = new Set(prev);
            if (isSpeaking) next.add(currentUserId);
            else next.delete(currentUserId);
            return next;
          });
        }
      }, 100);
    } catch {
      // AudioContext not available
    }
  }, [channelId, currentUserId]);

  const stopVAD = useCallback(() => {
    if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null; }
    analyserRef.current = null;
    wasSpeakingRef.current = false;
  }, []);

  const changeMicrophone = useCallback(async (deviceId: string, requestId: number) => {
    if (
      requestId !== microphoneChangeIdRef.current
      || !joinedRef.current
      || !localStreamRef.current
    ) {
      return;
    }

    let replacementStream: MediaStream;
    let usedDefault = false;
    try {
      const requested = await requestVoiceStream(navigator.mediaDevices, deviceId);
      replacementStream = requested.stream;
      usedDefault = requested.usedDefault;
    } catch (error) {
      if (requestId === microphoneChangeIdRef.current) {
        console.error("[Voice] Could not switch input device; keeping the current microphone:", error);
      }
      return;
    }

    const { stream: outgoingStream, pipeline } = await applyInputGain(
      replacementStream,
      inputVolumeRef.current,
    );
    const currentStream = localStreamRef.current;
    if (
      requestId !== microphoneChangeIdRef.current
      || !joinedRef.current
      || !currentStream
    ) {
      outgoingStream.getTracks().forEach((track) => track.stop());
      replacementStream.getTracks().forEach((track) => track.stop());
      releaseInputGain(pipeline);
      return;
    }

    const senders = Array.from(peersRef.current.values())
      .flatMap((peer) => peer.getSenders());
    const replaced = await replaceActiveAudioTrack(
      currentStream,
      outgoingStream,
      senders,
    );

    if (!replaced) {
      releaseInputGain(pipeline);
      console.error("[Voice] Could not replace every outgoing audio track; keeping the current microphone.");
      return;
    }

    if (!joinedRef.current) {
      outgoingStream.getTracks().forEach((track) => track.stop());
      releaseInputGain(pipeline);
      return;
    }

    // The previous processed track was stopped by replaceActiveAudioTrack;
    // its raw mic and AudioContext go with it.
    releaseInputGain(inputGainRef.current);
    inputGainRef.current = pipeline;
    stopVAD();
    localStreamRef.current = outgoingStream;
    startVAD(outgoingStream);
    if (usedDefault) {
      mediaDeviceSettingsRef.current = {
        ...mediaDeviceSettingsRef.current,
        inputDevice: "",
      };
      clearUnavailableMediaDevice("inputDevice");
    }
  }, [startVAD, stopVAD]);

  const queueMicrophoneChange = useCallback((deviceId: string) => {
    const requestId = ++microphoneChangeIdRef.current;
    microphoneChangeQueueRef.current = microphoneChangeQueueRef.current
      .then(() => changeMicrophone(deviceId, requestId))
      .catch((error) => {
        console.error("[Voice] Unexpected microphone switch failure:", error);
      });
  }, [changeMicrophone]);

  useEffect(() => {
    function applyDeviceSettings(nextSettings: MediaDeviceSettings) {
      const previousSettings = mediaDeviceSettingsRef.current;
      mediaDeviceSettingsRef.current = nextSettings;
      const inputChanged = previousSettings.inputDevice !== nextSettings.inputDevice;
      const outputChanged = previousSettings.outputDevice !== nextSettings.outputDevice;

      if (outputChanged) {
        audioElementsRef.current.forEach((audio) => {
          void applyAudioOutputDevice(audio, nextSettings.outputDevice);
        });
      }

      if (
        inputChanged
        && joinedRef.current
        && localStreamRef.current
      ) {
        queueMicrophoneChange(nextSettings.inputDevice);
      }

      return { inputChanged, outputChanged };
    }

    // Sensitivity, Input Volume and Output Volume from the same saved settings
    // SettingsModal writes (previously only applied once Settings was opened).
    function applyLevelSettings() {
      const settings = readAudioSettings();
      vadThresholdRef.current = clampSetting(settings.inputSensitivity, 15, 1, 100);

      const output = clampSetting(settings.outputVolume, 100, 0, 200) / 100;
      if (output !== outputVolumeRef.current) {
        outputVolumeRef.current = output;
        audioElementsRef.current.forEach((audio, socketId) => {
          applyRemoteVolume(audio, socketToUserRef.current.get(socketId));
        });
      }

      const input = clampSetting(settings.inputVolume, 100, 0, 200) / 100;
      if (input !== inputVolumeRef.current) {
        inputVolumeRef.current = input;
        if (inputGainRef.current) {
          inputGainRef.current.gain.gain.value = input;
        } else if (input !== 1 && joinedRef.current && localStreamRef.current) {
          // Live call on the raw mic: rebuild it through the gain stage.
          queueMicrophoneChange(mediaDeviceSettingsRef.current.inputDevice);
        }
      }
    }

    function handleDeviceSettingsChange(event: Event) {
      const nextSettings = (event as CustomEvent<MediaDeviceSettings>).detail;
      applyDeviceSettings(nextSettings ?? readMediaDeviceSettings());
      applyLevelSettings();
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === AUDIO_SETTINGS_STORAGE_KEY || event.key === null) {
        applyDeviceSettings(readMediaDeviceSettings());
        applyLevelSettings();
      }
    }

    async function refreshAvailableDevices() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const reconciled = reconcileMediaDeviceSettings(readAudioSettings(), devices);
        const nextSettings = getMediaDeviceSettings(reconciled.settings);
        const { inputChanged, outputChanged } = applyDeviceSettings(nextSettings);

        if (reconciled.changed) saveAudioSettings(reconciled.settings);

        if (!outputChanged) {
          audioElementsRef.current.forEach((audio) => {
            void applyAudioOutputDevice(audio, nextSettings.outputDevice);
          });
        }

        const activeTrack = localStreamRef.current?.getAudioTracks()[0];
        const activeDeviceId = activeTrack?.getSettings().deviceId;
        const availableInputs = new Set(
          devices
            .filter((device) => device.kind === "audioinput")
            .map((device) => device.deviceId),
        );
        const activeInputUnavailable = activeTrack?.readyState === "ended"
          || Boolean(activeDeviceId && !availableInputs.has(activeDeviceId));

        if (
          !inputChanged
          && activeInputUnavailable
          && joinedRef.current
          && localStreamRef.current
        ) {
          queueMicrophoneChange(nextSettings.inputDevice);
        }
      } catch (error) {
        console.error("[Voice] Could not refresh media devices:", error);
      }
    }

    function handleDeviceChange() {
      void refreshAvailableDevices();
    }

    applyDeviceSettings(readMediaDeviceSettings());
    applyLevelSettings();
    window.addEventListener(MEDIA_DEVICE_SETTINGS_EVENT, handleDeviceSettingsChange);
    window.addEventListener("storage", handleStorage);
    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      window.removeEventListener(MEDIA_DEVICE_SETTINGS_EVENT, handleDeviceSettingsChange);
      window.removeEventListener("storage", handleStorage);
      navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [queueMicrophoneChange, applyRemoteVolume]);

  // ─── Screen Share Logic ───

  const cleanupScreenPeers = useCallback(() => {
    screenPeersRef.current.forEach((pc) => pc.close());
    screenPeersRef.current.clear();
  }, []);

  const createScreenPeer = useCallback(async (remoteSocketId: string, initiator: boolean) => {
    const configuration = await getIceServers();
    const existingPeer = screenPeersRef.current.get(remoteSocketId);
    if (existingPeer && existingPeer.connectionState !== "closed") {
      existingPeer.setConfiguration(configuration);
      return existingPeer;
    }
    const pc = new RTCPeerConnection(configuration);
    const socket = getSocket();

    if (initiator && screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, screenStreamRef.current!);
      });
    }

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (!stream) return;
      const userId = socketToUserRef.current.get(remoteSocketId) || remoteSocketId;
      // Find username from participants
      const participant = participants.find((p) => p.userId === userId);
      const info: ScreenShareInfo = {
        userId,
        username: participant?.username || "Unknown",
        stream,
      };
      incomingScreensRef.current.set(userId, info);
      setIncomingScreens(Array.from(incomingScreensRef.current.values()));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit("screen:ice-candidate", { to: remoteSocketId, channelId, candidate: event.candidate.toJSON() });
      }
    };

    screenPeersRef.current.set(remoteSocketId, pc);
    if (initiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("screen:offer", { to: remoteSocketId, channelId, offer: pc.localDescription! });
      } catch (error) {
        if (screenPeersRef.current.get(remoteSocketId) === pc) {
          screenPeersRef.current.delete(remoteSocketId);
        }
        pc.close();
        throw error;
      }
    }

    return pc;
  }, [participants, channelId]);

  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      screenStreamRef.current = null;
    }
    cleanupScreenPeers();
    setSharing(false);
    getSocket().emit("screen:stop", { channelId });
  }, [channelId, cleanupScreenPeers]);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as MediaTrackConstraints,
        audio: true,
      });

      screenStreamRef.current = stream;
      setSharing(true);
      getSocket().emit("screen:start", { channelId });

      // Send screen to all existing voice peers
      for (const [socketId] of peersRef.current) {
        await createScreenPeer(socketId, true);
      }

      // Handle user stopping share via browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.error("[Screen] Share failed:", err);
    }
  }, [channelId, createScreenPeer, stopScreenShare]);

  // ─── Camera Logic ───

  const toggleCamera = useCallback(async () => {
    const socket = getSocket();

    if (cameraStreamRef.current) {
      // Turn off: stop tracks, remove senders from all peers
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;

      for (const [socketId, sender] of videoSendersRef.current) {
        const pc = peersRef.current.get(socketId);
        if (pc) {
          try { pc.removeTrack(sender); } catch {}
          // Renegotiate
          pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => { socket.emit("voice:offer", { to: socketId, channelId, offer: pc.localDescription! }); })
            .catch(() => {});
        }
      }
      videoSendersRef.current.clear();
      setCameraOn(false);
      socket.emit("voice:camera", { channelId, camera: false });
    } else {
      // Turn on: get camera stream, add video track to all peers
      try {
        const { videoDevice } = readMediaDeviceSettings();
        const { stream, usedDefault } = await requestCameraStream(
          navigator.mediaDevices,
          videoDevice,
        );
        if (usedDefault) {
          mediaDeviceSettingsRef.current = {
            ...mediaDeviceSettingsRef.current,
            videoDevice: "",
          };
          clearUnavailableMediaDevice("videoDevice");
        }
        cameraStreamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];

        for (const [socketId, pc] of peersRef.current) {
          const sender = pc.addTrack(videoTrack, stream);
          videoSendersRef.current.set(socketId, sender);
          // Renegotiate
          pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => { socket.emit("voice:offer", { to: socketId, channelId, offer: pc.localDescription! }); })
            .catch(() => {});
        }

        setCameraOn(true);
        socket.emit("voice:camera", { channelId, camera: true });

        // Handle track ending (user revokes permission)
        videoTrack.onended = () => {
          cameraStreamRef.current = null;
          videoSendersRef.current.clear();
          setCameraOn(false);
          socket.emit("voice:camera", { channelId, camera: false });
        };
      } catch (err) {
        console.error("[Camera] Access failed:", err);
      }
    }
  }, [channelId]);

  // Screen share signaling handlers
  useEffect(() => {
    if (!joined) return;
    const socket = getSocket();

    function handleScreenStarted(data: { userId: string; username: string; socketId: string }) {
      if (data.userId === currentUserId) return;
      // The sharer will send us an offer — we just wait
    }

    function handleScreenStopped(data: { userId: string }) {
      incomingScreensRef.current.delete(data.userId);
      setIncomingScreens(Array.from(incomingScreensRef.current.values()));
      // Cleanup peer
      for (const [socketId, uid] of socketToUserRef.current) {
        if (uid === data.userId) {
          const pc = screenPeersRef.current.get(socketId);
          if (pc) { pc.close(); screenPeersRef.current.delete(socketId); }
        }
      }
    }

    async function handleScreenOffer(data: { from: string; fromUserId: string; fromUsername: string; offer: RTCSessionDescriptionInit }) {
      socketToUserRef.current.set(data.from, data.fromUserId);
      try {
        const pc = await createScreenPeer(data.from, false);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("screen:answer", { to: data.from, channelId, answer: pc.localDescription! });
      } catch (error) {
        console.error("[Screen] Could not answer offer:", error);
      }
    }

    function handleScreenAnswer(data: { from: string; answer: RTCSessionDescriptionInit }) {
      const pc = screenPeersRef.current.get(data.from);
      if (pc) pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }

    function handleScreenIce(data: { from: string; candidate: RTCIceCandidateInit }) {
      const pc = screenPeersRef.current.get(data.from);
      if (pc) pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }

    socket.on("screen:started", handleScreenStarted);
    socket.on("screen:stopped", handleScreenStopped);
    socket.on("screen:offer", handleScreenOffer);
    socket.on("screen:answer", handleScreenAnswer);
    socket.on("screen:ice-candidate", handleScreenIce);

    return () => {
      socket.off("screen:started", handleScreenStarted);
      socket.off("screen:stopped", handleScreenStopped);
      socket.off("screen:offer", handleScreenOffer);
      socket.off("screen:answer", handleScreenAnswer);
      socket.off("screen:ice-candidate", handleScreenIce);
    };
  }, [joined, currentUserId, createScreenPeer, channelId]);

  // Report screen shares to parent
  useEffect(() => {
    onScreenShareChange?.(incomingScreens);
  }, [incomingScreens, onScreenShareChange]);

  // Report video streams to parent
  useEffect(() => {
    onVideoStreamsChange?.(remoteVideoStreams);
  }, [remoteVideoStreams, onVideoStreamsChange]);

  // Seeded from useVoice's pttMode (the source of truth) so a remount keeps it.
  const pttModeRef = useRef(pttMode);
  useEffect(() => { pttModeRef.current = pttMode; }, [pttMode]);

  const setPTT = useCallback((enabled: boolean) => {
    pttModeRef.current = enabled;
    if (enabled && localStreamRef.current) {
      // Entering PTT: mute mic by default
      localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = false; });
      setMuted(true);
      const socket = getSocket();
      socket.emit("voice:mute", { channelId, muted: true });
    }
  }, [channelId]);

  // PTT key handler (Space bar)
  useEffect(() => {
    if (!joined) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (!pttModeRef.current) return;
      if (e.code !== "Space") return;
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      e.preventDefault();
      if (e.repeat) return;
      // A server mute outranks push-to-talk.
      if (serverMutedRef.current) return;
      // Unmute while key held
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = true; });
        setMuted(false);
        const socket = getSocket();
        socket.emit("voice:mute", { channelId, muted: false });
      }
    }

    function handleKeyUp(e: KeyboardEvent) {
      if (!pttModeRef.current) return;
      if (e.code !== "Space") return;
      e.preventDefault();
      // Re-mute on release
      if (localStreamRef.current) {
        localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = false; });
        setMuted(true);
        const socket = getSocket();
        socket.emit("voice:mute", { channelId, muted: true });
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [joined, channelId]);

  const createPeer = useCallback(
    async function createPeer(remoteSocketId: string, initiator: boolean, remoteUserId?: string) {
      const configuration = await getIceServers();
      const existingPeer = peersRef.current.get(remoteSocketId);
      if (existingPeer && existingPeer.connectionState !== "closed") {
        existingPeer.setConfiguration(configuration);
        return existingPeer;
      }
      const pc = new RTCPeerConnection(configuration);
      const socket = getSocket();
      const pendingReconnect = reconnectTimersRef.current.get(remoteSocketId);
      if (pendingReconnect) {
        clearTimeout(pendingReconnect);
        reconnectTimersRef.current.delete(remoteSocketId);
      }

      if (remoteUserId) {
        socketToUserRef.current.set(remoteSocketId, remoteUserId);
      }

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }
      // A camera that is already live goes to new peers too, not only to the
      // peers present when it was switched on.
      const cameraStream = cameraStreamRef.current;
      const cameraTrack = cameraStream?.getVideoTracks()[0];
      if (cameraStream && cameraTrack?.readyState === "live") {
        videoSendersRef.current.set(remoteSocketId, pc.addTrack(cameraTrack, cameraStream));
      }

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        const track = event.track;

        if (track.kind === "audio") {
          let audio = audioElementsRef.current.get(remoteSocketId);
          if (!audio) {
            audio = new Audio();
            audio.autoplay = true;
            audioElementsRef.current.set(remoteSocketId, audio);
          }
          audio.srcObject = stream;
          audio.muted = deafenedRef.current;
          void applyAudioOutputDevice(audio, mediaDeviceSettingsRef.current.outputDevice);
          // Apply saved per-user and output volume
          applyRemoteVolume(audio, socketToUserRef.current.get(remoteSocketId));
        } else if (track.kind === "video") {
          const uid = socketToUserRef.current.get(remoteSocketId) || remoteSocketId;
          // Create a new stream with just this video track
          const videoStream = new MediaStream([track]);
          remoteVideoStreamsRef.current.set(uid, videoStream);
          setRemoteVideoStreams(new Map(remoteVideoStreamsRef.current));

          track.onended = () => {
            remoteVideoStreamsRef.current.delete(uid);
            setRemoteVideoStreams(new Map(remoteVideoStreamsRef.current));
          };
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("voice:ice-candidate", { to: remoteSocketId, channelId, candidate: event.candidate.toJSON() });
        }
      };

      pc.onconnectionstatechange = () => {
        const uid = socketToUserRef.current.get(remoteSocketId);
        if (!uid) return;
        const state = pc.connectionState;
        const baseQuality: "good" | "fair" | "poor" | "unknown" =
          state === "connected" ? "good" :
          state === "connecting" || state === "new" ? "fair" : "poor";
        setConnectionQualities((prev) => {
          const next = new Map(prev);
          if (state === "closed") {
            next.delete(uid);
          } else {
            const prevEntry = next.get(uid);
            next.set(uid, { quality: baseQuality, pingMs: prevEntry?.pingMs });
          }
          return next;
        });

        // ─── Peer Reconnection ───
        // If the connection fails or stays disconnected, retry
        if (state === "failed") {
          console.log(`[Campfire] Peer connection failed for ${uid}, reconnecting...`);
          pc.close();
          peersRef.current.delete(remoteSocketId);
          audioElementsRef.current.get(remoteSocketId)?.remove();
          audioElementsRef.current.delete(remoteSocketId);
          // Re-create as initiator after a short delay
          const pendingReconnect = reconnectTimersRef.current.get(remoteSocketId);
          if (pendingReconnect) clearTimeout(pendingReconnect);
          const reconnectTimer = setTimeout(() => {
            reconnectTimersRef.current.delete(remoteSocketId);
            if (!joinedRef.current) return;
            void createPeer(remoteSocketId, true, uid).catch((error) => {
              console.error("[Voice] Could not recreate failed peer:", error);
            });
          }, 1000);
          reconnectTimersRef.current.set(remoteSocketId, reconnectTimer);
        } else if (state === "disconnected") {
          // Disconnected can recover on its own — wait 5s before forcing reconnect
          const timer = setTimeout(() => {
            reconnectTimersRef.current.delete(remoteSocketId);
            if (pc.connectionState === "disconnected") {
              console.log(`[Campfire] Peer still disconnected for ${uid}, reconnecting...`);
              pc.close();
              peersRef.current.delete(remoteSocketId);
              audioElementsRef.current.get(remoteSocketId)?.remove();
              audioElementsRef.current.delete(remoteSocketId);
              if (joinedRef.current) {
                void createPeer(remoteSocketId, true, uid).catch((error) => {
                  console.error("[Voice] Could not recreate disconnected peer:", error);
                });
              }
            }
          }, 5000);
          const pendingReconnect = reconnectTimersRef.current.get(remoteSocketId);
          if (pendingReconnect) clearTimeout(pendingReconnect);
          reconnectTimersRef.current.set(remoteSocketId, timer);
          // If it reconnects, cancel the timer
          const origHandler = pc.onconnectionstatechange;
          pc.onconnectionstatechange = () => {
            if (pc.connectionState === "connected") {
              clearTimeout(timer);
              if (reconnectTimersRef.current.get(remoteSocketId) === timer) {
                reconnectTimersRef.current.delete(remoteSocketId);
              }
            }
            if (origHandler) (origHandler as () => void)();
          };
        }
      };

      peersRef.current.set(remoteSocketId, pc);
      if (initiator) {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("voice:offer", { to: remoteSocketId, channelId, offer: pc.localDescription! });
        } catch (error) {
          if (peersRef.current.get(remoteSocketId) === pc) {
            peersRef.current.delete(remoteSocketId);
          }
          pc.close();
          throw error;
        }
      }

      return pc;
    },
    [channelId, applyRemoteVolume]
  );

  const autoJoin = useEffectEvent(async (isCancelled: () => boolean) => {
    try {
      // Refresh once per join to prevent a previous SPA session's user-bound
      // credential from crossing a logout/login boundary.
      invalidateRuntimeConfig();
      await ensureRuntimeConfig({ forceRefresh: true });
      if (isCancelled()) return;
      const deviceSettings = readMediaDeviceSettings();
      mediaDeviceSettingsRef.current = deviceSettings;
      const { stream: micStream, usedDefault } = await requestVoiceStream(
        navigator.mediaDevices,
        deviceSettings.inputDevice,
      );
      if (usedDefault) {
        mediaDeviceSettingsRef.current = {
          ...mediaDeviceSettingsRef.current,
          inputDevice: "",
        };
        clearUnavailableMediaDevice("inputDevice");
      }
      if (isCancelled()) { micStream.getTracks().forEach((track) => track.stop()); return; }
      const { stream, pipeline } = await applyInputGain(micStream, inputVolumeRef.current);
      if (isCancelled()) {
        stream.getTracks().forEach((track) => track.stop());
        micStream.getTracks().forEach((track) => track.stop());
        releaseInputGain(pipeline);
        return;
      }
      // Push-to-talk joins with the mic closed; the server learns the initial
      // state with the join itself.
      const startMuted = pttModeRef.current;
      if (startMuted) stream.getAudioTracks().forEach((track) => { track.enabled = false; });
      localStreamRef.current = stream;
      inputGainRef.current = pipeline;
      startVAD(stream);
      const socket = getSocket();
      socket.emit("voice:join", { channelId, serverId, avatar: currentUserAvatar, muted: startMuted });
      joinedChannelRef.current = channelId;
      if (startMuted) setMuted(true);
      setJoined(true);
      joinedRef.current = true;
      sounds.voiceJoin();
    } catch (err) {
      console.error("[Voice] Mic access failed:", err);
      toast("Could not access your microphone. Check browser permissions.", "error");
      onDisconnect?.();
    }
  });

  // Auto-join when mounted (parent mounts us when user clicks a voice channel)
  useEffect(() => {
    let cancelled = false;

    void autoJoin(() => cancelled);

    return () => { cancelled = true; };
  }, [channelId]);

  const leaveVoice = useCallback(() => {
    const socket = getSocket();
    const leavingChannel = joinedChannelRef.current;
    // Stop screen share if active. screen:stop must precede voice:leave: the
    // server only relays it from a current room member.
    if (screenStreamRef.current) {
      if (leavingChannel) socket.emit("screen:stop", { channelId: leavingChannel });
      screenStreamRef.current.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      screenStreamRef.current = null;
      cleanupScreenPeers();
      setSharing(false);
    }
    if (leavingChannel) {
      socket.emit("voice:leave", leavingChannel);
    }
    // Stop camera if active
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
      videoSendersRef.current.clear();
      setCameraOn(false);
    }
    remoteVideoStreamsRef.current.clear();
    setRemoteVideoStreams(new Map());
    incomingScreensRef.current.clear();
    setIncomingScreens([]);
    stopVAD();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    releaseInputGain(inputGainRef.current);
    inputGainRef.current = null;
    cleanupPeers();
    joinedChannelRef.current = null;
    setJoined(false);
    joinedRef.current = false;
    microphoneChangeIdRef.current += 1;
    setMuted(false);
    setDeafened(false);
    deafenedRef.current = false;
    setParticipants([]);
    setOffshootRooms(null);
    setSpeakingUsers(new Set());
    sounds.voiceLeave();
    onDisconnect?.();
  }, [cleanupPeers, cleanupScreenPeers, stopVAD, onDisconnect]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const newMuted = !muted;
    if (!newMuted && (selfServerMuted || selfServerDeafened)) {
      toast("A moderator has server-muted you.", "error");
      return;
    }
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !newMuted; });
    setMuted(newMuted);
    const socket = getSocket();
    socket.emit("voice:mute", { channelId, muted: newMuted });
  }, [muted, channelId, selfServerMuted, selfServerDeafened]);

  const toggleDeafen = useCallback(() => {
    const newDeafened = !deafened;
    if (!newDeafened && selfServerDeafened) {
      toast("A moderator has server-deafened you.", "error");
      return;
    }
    setDeafened(newDeafened);
    deafenedRef.current = newDeafened;
    audioElementsRef.current.forEach((audio) => { audio.muted = newDeafened; });
    const socket = getSocket();
    socket.emit("voice:deafen", { channelId, deafened: newDeafened });
    if (newDeafened && !muted) {
      if (!localStreamRef.current) return;
      localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = false; });
      setMuted(true);
      socket.emit("voice:mute", { channelId, muted: true });
    }
  }, [deafened, muted, channelId, selfServerDeafened]);

  // Expose controls to parent via ref
  useImperativeHandle(ref, () => ({
    toggleMute,
    toggleDeafen,
    disconnect: leaveVoice,
    setPTT,
    isPTT: () => pttModeRef.current,
    setUserVolume: (userId: string, volume: number) => {
      userVolumesRef.current.set(userId, Math.max(0, Math.min(1, volume)));
      applyUserVolumes(userId);
    },
    setUserRoutingMuted: applyRoutingMuted,
    setInputSensitivity: (threshold: number) => {
      vadThresholdRef.current = Math.max(1, Math.min(100, threshold));
    },
    forceMute: () => {
      if (!muted) toggleMute();
    },
    forceDeafen: () => {
      if (!deafened) toggleDeafen();
    },
    startScreenShare,
    stopScreenShare,
    toggleCamera,
    getVideoStreams: () => remoteVideoStreamsRef.current,
    getLocalCameraStream: () => cameraStreamRef.current,
    getLocalScreenStream: () => screenStreamRef.current,
  }), [toggleMute, toggleDeafen, leaveVoice, setPTT, applyUserVolumes, applyRoutingMuted, muted, deafened, startScreenShare, stopScreenShare, toggleCamera]);

  // Report state changes to parent — merge speaking state and connection quality into participants
  useEffect(() => {
    let allParticipants = participants;
    // Ensure current user always appears in the participant list when joined
    if (joined && !participants.some((p) => p.userId === currentUserId)) {
      allParticipants = [
        ...participants,
        { userId: currentUserId, username: currentUsername, muted, deafened, camera: cameraOn, avatar: currentUserAvatar } as VoiceParticipant,
      ];
    }
    const withSpeaking = allParticipants.map((p) => {
      if (p.userId === currentUserId) {
        return { ...p, speaking: speakingUsers.has(p.userId), connectionQuality: "good" as const, pingMs: undefined };
      }
      const entry = connectionQualities.get(p.userId);
      return {
        ...p,
        speaking: speakingUsers.has(p.userId),
        connectionQuality: entry?.quality ?? ("fair" as const),
        pingMs: entry?.pingMs,
      };
    });
    onStateChange?.({
      muted,
      deafened,
      reconnecting,
      participants: withSpeaking,
      sharing,
      cameraOn,
      serverMuted: selfServerMuted,
      serverDeafened: selfServerDeafened,
    });
  }, [joined, muted, deafened, reconnecting, participants, speakingUsers, connectionQualities, sharing, cameraOn, onStateChange, currentUserId, currentUsername, currentUserAvatar, selfServerMuted, selfServerDeafened]);

  // The server refused this join, or evicted us after a permission/role
  // change: leave instead of sitting in a dead room.
  const onVoiceError = useEffectEvent((data: { channelId: string; error?: string }) => {
    if (data.channelId !== channelId) return;
    toast(data.error || "Could not join this voice channel.", "error");
    leaveVoice();
  });
  useEffect(() => {
    const socket = getSocket();
    function handleVoiceError(data: { channelId: string; error?: string }) {
      onVoiceError(data);
    }
    socket.on("voice:error", handleVoiceError);
    return () => { socket.off("voice:error", handleVoiceError); };
  }, []);

  // Side fires (offshoots): only hear people in the same side fire (or the
  // main camp). Lives here, not in VoiceRoom, so it holds while the room view
  // is closed and you browse text channels.
  useEffect(() => {
    const socket = getSocket();
    function handleOffshootUpdate(state: { channelId: string; offshoots: OffshootRoute[] }) {
      if (state.channelId !== channelId) return;
      setOffshootRooms(state.offshoots);
    }
    socket.on("offshoot:update", handleOffshootUpdate);
    return () => { socket.off("offshoot:update", handleOffshootUpdate); };
  }, [channelId]);

  useEffect(() => {
    const next = new Set<string>();
    if (offshootRooms) {
      const roomOf = (userId: string) =>
        offshootRooms.find((room) => room.members.some((member) => member.userId === userId))?.id ?? null;
      const myRoom = roomOf(currentUserId);
      for (const participant of participants) {
        if (participant.userId !== currentUserId && roomOf(participant.userId) !== myRoom) {
          next.add(participant.userId);
        }
      }
    }
    for (const userId of autoRoutedUsersRef.current) {
      if (!next.has(userId)) applyRoutingMuted(userId, false);
    }
    for (const userId of next) {
      if (!autoRoutedUsersRef.current.has(userId)) applyRoutingMuted(userId, true);
    }
    autoRoutedUsersRef.current = next;
  }, [offshootRooms, participants, currentUserId, applyRoutingMuted]);

  // Participant updates — register BEFORE joining so we don't miss the initial broadcast
  useEffect(() => {
    const socket = getSocket();

    function handleParticipantsUpdate(data: { channelId: string; participants: VoiceParticipant[] }) {
      if (data.channelId !== channelId) return;
      setParticipants(data.participants);
      onParticipantsChange?.(data.channelId, data.participants);
    }

    socket.on("voice:participants-update", handleParticipantsUpdate);
    return () => { socket.off("voice:participants-update", handleParticipantsUpdate); };
  }, [channelId, onParticipantsChange]);

  // Remote speaking indicators
  useEffect(() => {
    if (!joined) return;
    const socket = getSocket();

    function handleSpeaking(data: { userId: string; speaking: boolean }) {
      setSpeakingUsers((prev) => {
        const next = new Set(prev);
        if (data.speaking) next.add(data.userId);
        else next.delete(data.userId);
        return next;
      });
    }

    socket.on("voice:speaking", handleSpeaking);
    return () => { socket.off("voice:speaking", handleSpeaking); };
  }, [joined]);

  // WebRTC signaling handlers — only after joined
  useEffect(() => {
    if (!joined) return;
    const socket = getSocket();

    function handleParticipants(data: {
      channelId: string;
      participants: { userId: string; username: string; socketId: string; muted: boolean }[];
    }) {
      if (data.channelId !== channelId) return;
      data.participants.forEach((p) => {
        if (p.userId !== currentUserId) {
          void createPeer(p.socketId, true, p.userId).catch((error) => {
            console.error("[Voice] Could not create participant peer:", error);
          });
          // Rejoining after a reconnect mid-share: peers dropped the old share.
          if (screenStreamRef.current) {
            socketToUserRef.current.set(p.socketId, p.userId);
            void createScreenPeer(p.socketId, true).catch((error) => {
              console.error("[Screen] Could not re-share to participant:", error);
            });
          }
        }
      });
    }

    function handleUserJoined(data: { channelId: string; userId: string; socketId: string }) {
      if (data.channelId !== channelId || data.userId === currentUserId) return;
      sounds.voiceJoin();
      // If we're sharing screen, send it to the new peer
      if (screenStreamRef.current) {
        void createScreenPeer(data.socketId, true).catch((error) => {
          console.error("[Screen] Could not create peer for new participant:", error);
        });
      }
    }

    function handleUserLeft(data: { channelId: string; userId?: string; socketId: string }) {
      if (data.channelId !== channelId) return;
      sounds.voiceLeave();
      const reconnectTimer = reconnectTimersRef.current.get(data.socketId);
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimersRef.current.delete(data.socketId);
      }
      iceRestartingPeersRef.current.delete(data.socketId);
      const pc = peersRef.current.get(data.socketId);
      if (pc) { pc.close(); peersRef.current.delete(data.socketId); }
      videoSendersRef.current.delete(data.socketId);
      const audio = audioElementsRef.current.get(data.socketId);
      if (audio) { audio.srcObject = null; audio.remove(); audioElementsRef.current.delete(data.socketId); }
      // Drop their screen share and camera tile instead of leaving them frozen.
      const screenPc = screenPeersRef.current.get(data.socketId);
      if (screenPc) { screenPc.close(); screenPeersRef.current.delete(data.socketId); }
      const leftUserId = data.userId ?? socketToUserRef.current.get(data.socketId);
      if (leftUserId && incomingScreensRef.current.delete(leftUserId)) {
        setIncomingScreens(Array.from(incomingScreensRef.current.values()));
      }
      if (leftUserId && remoteVideoStreamsRef.current.delete(leftUserId)) {
        setRemoteVideoStreams(new Map(remoteVideoStreamsRef.current));
      }
    }

    async function handleOffer(data: { from: string; fromUserId?: string; offer: RTCSessionDescriptionInit }) {
      try {
        const pc = await createPeer(data.from, false, data.fromUserId);
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("voice:answer", { to: data.from, channelId, answer: pc.localDescription! });
        // Our live camera was attached in createPeer, but a joiner's audio-only
        // offer has no slot for it: renegotiate so they actually receive it.
        const unsentVideo = pc.getTransceivers().some(
          (transceiver) => transceiver.sender.track?.kind === "video" && !transceiver.mid,
        );
        if (unsentVideo) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("voice:offer", { to: data.from, channelId, offer: pc.localDescription! });
        }
      } catch (error) {
        console.error("[Voice] Could not answer offer:", error);
      }
    }

    function handleAnswer(data: { from: string; answer: RTCSessionDescriptionInit }) {
      const pc = peersRef.current.get(data.from);
      if (pc) pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }

    function handleIceCandidate(data: { from: string; candidate: RTCIceCandidateInit }) {
      const pc = peersRef.current.get(data.from);
      if (pc) pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }

    socket.on("voice:participants", handleParticipants);
    socket.on("voice:user-joined", handleUserJoined);
    socket.on("voice:user-left", handleUserLeft);
    socket.on("voice:offer", handleOffer);
    socket.on("voice:answer", handleAnswer);
    socket.on("voice:ice-candidate", handleIceCandidate);

    return () => {
      socket.off("voice:participants", handleParticipants);
      socket.off("voice:user-joined", handleUserJoined);
      socket.off("voice:user-left", handleUserLeft);
      socket.off("voice:offer", handleOffer);
      socket.off("voice:answer", handleAnswer);
      socket.off("voice:ice-candidate", handleIceCandidate);
    };
  }, [joined, channelId, currentUserId, createPeer, createScreenPeer]);

  // Socket reconnect handler — rejoin voice room after disconnect
  useEffect(() => {
    if (!joined) return;
    const socket = getSocket();

    function handleDisconnect() {
      setReconnecting(true);
      cleanupPeers();
      // Incoming shares/cameras rode on the dropped peers; the sharers send
      // fresh ones when we rejoin.
      cleanupScreenPeers();
      incomingScreensRef.current.clear();
      setIncomingScreens([]);
      remoteVideoStreamsRef.current.clear();
      setRemoteVideoStreams(new Map());
    }

    function handleReconnect() {
      setReconnecting(false);
      // Rejoin voice channel; mute/deafen ride along with the join (a separate
      // voice:mute would arrive before the server finishes the async join).
      socket.emit("voice:join", { channelId, serverId, avatar: currentUserAvatar, muted, deafened });
    }

    socket.on("disconnect", handleDisconnect);
    socket.on("connect", handleReconnect);

    return () => {
      socket.off("disconnect", handleDisconnect);
      socket.off("connect", handleReconnect);
    };
  }, [joined, channelId, serverId, muted, deafened, cleanupPeers, cleanupScreenPeers, currentUserAvatar]);

  // ICE restart on peer connection failure
  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(() => {
      peersRef.current.forEach((pc, socketId) => {
        if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
          if (iceRestartingPeersRef.current.has(socketId)) return;
          iceRestartingPeersRef.current.add(socketId);
          console.log("[Voice] ICE restart for peer:", socketId);
          void getIceServers()
            .then((configuration) => {
              pc.setConfiguration(configuration);
              pc.restartIce();
              return pc.createOffer({ iceRestart: true });
            })
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => {
              const socket = getSocket();
              socket.emit("voice:offer", { to: socketId, channelId, offer: pc.localDescription! });
            })
            .catch((err) => console.error("[Voice] ICE restart failed:", err))
            .finally(() => { iceRestartingPeersRef.current.delete(socketId); });
        }
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [joined, channelId]);

  // WebRTC stats polling — updates connection quality with real RTT and packet loss data every 5s
  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(async () => {
      const newQuality = new Map<string, { quality: "good" | "fair" | "poor" | "unknown"; pingMs?: number }>();

      for (const [socketId, pc] of peersRef.current) {
        const uid = socketToUserRef.current.get(socketId) || socketId;
        try {
          const stats = await pc.getStats();
          let packetsLost = 0, packetsReceived = 0, jitter = 0, rtt = 0;

          stats.forEach((report) => {
            if (report.type === "inbound-rtp") {
              packetsLost += (report.packetsLost as number) || 0;
              packetsReceived += (report.packetsReceived as number) || 0;
              jitter = Math.max(jitter, (report.jitter as number) || 0);
            }
            if (report.type === "candidate-pair" && (report as RTCIceCandidatePairStats).currentRoundTripTime) {
              rtt = ((report as RTCIceCandidatePairStats).currentRoundTripTime as number) * 1000;
            }
          });

          const lossRate = packetsReceived > 0 ? packetsLost / (packetsLost + packetsReceived) : 0;
          let quality: "good" | "fair" | "poor" | "unknown" = "good";
          if (lossRate > 0.05 || jitter > 0.05 || rtt > 200) quality = "poor";
          else if (lossRate > 0.02 || jitter > 0.02 || rtt > 100) quality = "fair";

          newQuality.set(uid, { quality, pingMs: rtt > 0 ? Math.round(rtt) : undefined });
        } catch {
          newQuality.set(uid, { quality: "unknown" });
        }
      }

      if (newQuality.size > 0) {
        setConnectionQualities((prev) => {
          const next = new Map(prev);
          for (const [uid, entry] of newQuality) {
            next.set(uid, entry);
          }
          return next;
        });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [joined]);

  // Cleanup on unmount
  useEffect(() => {
    const videoSenders = videoSendersRef.current;
    const remoteVideoStreams = remoteVideoStreamsRef.current;
    const incomingScreens = incomingScreensRef.current;
    return () => {
      joinedRef.current = false;
      microphoneChangeIdRef.current += 1;
      if (joinedChannelRef.current) {
        // Stop a live share first; the server ignores it once we've left.
        if (screenStreamRef.current) {
          getSocket().emit("screen:stop", { channelId: joinedChannelRef.current });
        }
        getSocket().emit("voice:leave", joinedChannelRef.current);
      }
      joinedChannelRef.current = null;
      stopVAD();
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      releaseInputGain(inputGainRef.current);
      inputGainRef.current = null;
      screenStreamRef.current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      screenStreamRef.current = null;
      cameraStreamRef.current?.getTracks().forEach((track) => {
        track.onended = null;
        track.stop();
      });
      cameraStreamRef.current = null;
      videoSenders.clear();
      remoteVideoStreams.clear();
      incomingScreens.clear();
      cleanupScreenPeers();
      cleanupPeers();
    };
  }, [cleanupPeers, cleanupScreenPeers, stopVAD]);

  // VoicePanel is now a headless WebRTC engine — VoiceRoom handles the UI
  return null;
});

export default VoicePanel;
