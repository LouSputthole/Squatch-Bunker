"use client";

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { getSocket } from "@/lib/socket";

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
  speaking?: boolean;
}

interface VoicePanelProps {
  channelId: string;
  channelName: string;
  serverId: string;
  currentUserId: string;
  onParticipantsChange?: (channelId: string, participants: VoiceParticipant[]) => void;
  onDisconnect?: () => void;
  onStateChange?: (state: { muted: boolean; deafened: boolean; reconnecting: boolean; participants: VoiceParticipant[]; sharing: boolean; cameraOn: boolean }) => void;
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
  togglePTT: () => void;
  isPTT: () => boolean;
  setUserVolume: (userId: string, volume: number) => void;
  setInputSensitivity: (threshold: number) => void;
  forceMute: () => void;
  forceDeafen: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  toggleCamera: () => Promise<void>;
  getVideoStreams: () => Map<string, MediaStream>;
  getLocalCameraStream: () => MediaStream | null;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

// Generate a short notification tone using Web Audio API
function playNotificationSound(type: "join" | "leave") {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "join") {
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.setValueAtTime(800, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.25);
    } else {
      osc.frequency.setValueAtTime(500, ctx.currentTime);
      osc.frequency.setValueAtTime(350, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.2);
    }
    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not available
  }
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
  channelName,
  serverId,
  currentUserId,
  onParticipantsChange,
  onDisconnect,
  onScreenShareChange,
  onVideoStreamsChange,
  onStateChange,
}, ref) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [pttMode, setPttMode] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [connecting, setConnecting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [sharing, setSharing] = useState(false);

  const [speakingUsers, setSpeakingUsers] = useState<Set<string>>(new Set());

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const joinedChannelRef = useRef<string | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wasSpeakingRef = useRef(false);
  const userVolumesRef = useRef<Map<string, number>>(new Map());
  const socketToUserRef = useRef<Map<string, string>>(new Map());
  const vadThresholdRef = useRef(15);

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
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    audioElementsRef.current.forEach((el) => { el.srcObject = null; el.remove(); });
    audioElementsRef.current.clear();
  }, []);

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

      vadIntervalRef.current = setInterval(() => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        const isSpeaking = avg > vadThresholdRef.current;

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

  // ─── Screen Share Logic ───

  const cleanupScreenPeers = useCallback(() => {
    screenPeersRef.current.forEach((pc) => pc.close());
    screenPeersRef.current.clear();
  }, []);

  const createScreenPeer = useCallback((remoteSocketId: string, initiator: boolean) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
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
        socket.emit("screen:ice-candidate", { to: remoteSocketId, candidate: event.candidate.toJSON() });
      }
    };

    if (initiator) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => { socket.emit("screen:offer", { to: remoteSocketId, offer: pc.localDescription! }); });
    }

    screenPeersRef.current.set(remoteSocketId, pc);
    return pc;
  }, [participants]);

  const startScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as MediaTrackConstraints,
        audio: true,
      });

      screenStreamRef.current = stream;
      setSharing(true);

      const socket = getSocket();
      socket.emit("screen:start", { channelId });

      // Send screen to all existing voice peers
      for (const [socketId] of peersRef.current) {
        createScreenPeer(socketId, true);
      }

      // Handle user stopping share via browser UI
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      console.error("[Screen] Share failed:", err);
    }
  }, [channelId, createScreenPeer]);

  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    cleanupScreenPeers();
    setSharing(false);
    const socket = getSocket();
    socket.emit("screen:stop", { channelId });
  }, [channelId, cleanupScreenPeers]);

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
            .then(() => { socket.emit("voice:offer", { to: socketId, offer: pc.localDescription! }); })
            .catch(() => {});
        }
      }
      videoSendersRef.current.clear();
      setCameraOn(false);
      socket.emit("voice:camera", { channelId, camera: false });
    } else {
      // Turn on: get camera stream, add video track to all peers
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } },
          audio: false,
        });
        cameraStreamRef.current = stream;
        const videoTrack = stream.getVideoTracks()[0];

        for (const [socketId, pc] of peersRef.current) {
          const sender = pc.addTrack(videoTrack, stream);
          videoSendersRef.current.set(socketId, sender);
          // Renegotiate
          pc.createOffer()
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => { socket.emit("voice:offer", { to: socketId, offer: pc.localDescription! }); })
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

    function handleScreenOffer(data: { from: string; fromUserId: string; fromUsername: string; offer: RTCSessionDescriptionInit }) {
      socketToUserRef.current.set(data.from, data.fromUserId);
      const pc = createScreenPeer(data.from, false);
      pc.setRemoteDescription(new RTCSessionDescription(data.offer))
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => { socket.emit("screen:answer", { to: data.from, answer: pc.localDescription! }); });
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
  }, [joined, currentUserId, createScreenPeer]);

  // Report screen shares to parent
  useEffect(() => {
    onScreenShareChange?.(incomingScreens);
  }, [incomingScreens, onScreenShareChange]);

  // Report video streams to parent
  useEffect(() => {
    onVideoStreamsChange?.(remoteVideoStreams);
  }, [remoteVideoStreams, onVideoStreamsChange]);

  const pttModeRef = useRef(false);

  const togglePTT = useCallback(() => {
    setPttMode((prev) => {
      const next = !prev;
      pttModeRef.current = next;
      if (next && localStreamRef.current) {
        // Entering PTT: mute mic by default
        localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = false; });
        setMuted(true);
        const socket = getSocket();
        socket.emit("voice:mute", { channelId, muted: true });
      }
      return next;
    });
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
    (remoteSocketId: string, initiator: boolean, remoteUserId?: string) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      const socket = getSocket();

      if (remoteUserId) {
        socketToUserRef.current.set(remoteSocketId, remoteUserId);
      }

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
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
          // Apply saved volume for this user
          const uid = socketToUserRef.current.get(remoteSocketId);
          if (uid && userVolumesRef.current.has(uid)) {
            audio.volume = userVolumesRef.current.get(uid)!;
          }
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
          socket.emit("voice:ice-candidate", { to: remoteSocketId, candidate: event.candidate.toJSON() });
        }
      };

      if (initiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => { socket.emit("voice:offer", { to: remoteSocketId, offer: pc.localDescription! }); });
      }

      peersRef.current.set(remoteSocketId, pc);
      return pc;
    },
    []
  );

  // Auto-join when mounted (parent mounts us when user clicks a voice channel)
  useEffect(() => {
    let cancelled = false;

    async function autoJoin() {
      setConnecting(true);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        startVAD(stream);
        const socket = getSocket();
        socket.emit("voice:join", { channelId, serverId });
        joinedChannelRef.current = channelId;
        setJoined(true);
        playNotificationSound("join");
      } catch (err) {
        console.error("[Voice] Mic access failed:", err);
        alert("Could not access microphone. Check browser permissions.");
        onDisconnect?.();
      } finally {
        setConnecting(false);
      }
    }

    autoJoin();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  const leaveVoice = useCallback(() => {
    const socket = getSocket();
    if (joinedChannelRef.current) {
      socket.emit("voice:leave", joinedChannelRef.current);
    }
    // Stop screen share if active
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      cleanupScreenPeers();
      setSharing(false);
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
    cleanupPeers();
    joinedChannelRef.current = null;
    setJoined(false);
    setMuted(false);
    setDeafened(false);
    setParticipants([]);
    setSpeakingUsers(new Set());
    playNotificationSound("leave");
    onDisconnect?.();
  }, [cleanupPeers, cleanupScreenPeers, stopVAD, onDisconnect]);

  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const newMuted = !muted;
    localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = !newMuted; });
    setMuted(newMuted);
    const socket = getSocket();
    socket.emit("voice:mute", { channelId, muted: newMuted });
  }, [muted, channelId]);

  const toggleDeafen = useCallback(() => {
    const newDeafened = !deafened;
    setDeafened(newDeafened);
    audioElementsRef.current.forEach((audio) => { audio.muted = newDeafened; });
    const socket = getSocket();
    socket.emit("voice:deafen", { channelId, deafened: newDeafened });
    if (newDeafened && !muted) {
      if (!localStreamRef.current) return;
      localStreamRef.current.getAudioTracks().forEach((t) => { t.enabled = false; });
      setMuted(true);
      socket.emit("voice:mute", { channelId, muted: true });
    }
  }, [deafened, muted, channelId]);

  // Expose controls to parent via ref
  useImperativeHandle(ref, () => ({
    toggleMute,
    toggleDeafen,
    disconnect: leaveVoice,
    togglePTT,
    isPTT: () => pttModeRef.current,
    setUserVolume: (userId: string, volume: number) => {
      const clamped = Math.max(0, Math.min(1, volume));
      userVolumesRef.current.set(userId, clamped);
      // Apply to active audio element
      for (const [socketId, uid] of socketToUserRef.current) {
        if (uid === userId) {
          const audio = audioElementsRef.current.get(socketId);
          if (audio) audio.volume = clamped;
        }
      }
    },
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
  }), [toggleMute, toggleDeafen, leaveVoice, togglePTT, muted, deafened, startScreenShare, stopScreenShare, toggleCamera]);

  // Report state changes to parent — merge speaking state into participants
  useEffect(() => {
    const withSpeaking = participants.map((p) => ({
      ...p,
      speaking: speakingUsers.has(p.userId),
    }));
    onStateChange?.({ muted, deafened, reconnecting, participants: withSpeaking, sharing, cameraOn });
  }, [muted, deafened, reconnecting, participants, speakingUsers, sharing, cameraOn, onStateChange]);

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
        if (p.userId !== currentUserId) createPeer(p.socketId, true, p.userId);
      });
    }

    function handleUserJoined(data: { channelId: string; userId: string; socketId: string }) {
      if (data.channelId !== channelId || data.userId === currentUserId) return;
      playNotificationSound("join");
      // If we're sharing screen, send it to the new peer
      if (screenStreamRef.current) {
        createScreenPeer(data.socketId, true);
      }
    }

    function handleUserLeft(data: { channelId: string; socketId: string }) {
      if (data.channelId !== channelId) return;
      playNotificationSound("leave");
      const pc = peersRef.current.get(data.socketId);
      if (pc) { pc.close(); peersRef.current.delete(data.socketId); }
      const audio = audioElementsRef.current.get(data.socketId);
      if (audio) { audio.srcObject = null; audio.remove(); audioElementsRef.current.delete(data.socketId); }
    }

    function handleOffer(data: { from: string; fromUserId?: string; offer: RTCSessionDescriptionInit }) {
      const pc = createPeer(data.from, false, data.fromUserId);
      pc.setRemoteDescription(new RTCSessionDescription(data.offer))
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => { socket.emit("voice:answer", { to: data.from, answer: pc.localDescription! }); });
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
  }, [joined, channelId, currentUserId, createPeer]);

  // Socket reconnect handler — rejoin voice room after disconnect
  useEffect(() => {
    if (!joined) return;
    const socket = getSocket();

    function handleDisconnect() {
      setReconnecting(true);
      cleanupPeers();
    }

    function handleReconnect() {
      setReconnecting(false);
      // Rejoin voice channel
      socket.emit("voice:join", { channelId, serverId });
      // Re-sync mute/deafen state
      if (muted) socket.emit("voice:mute", { channelId, muted: true });
      if (deafened) socket.emit("voice:deafen", { channelId, deafened: true });
    }

    socket.on("disconnect", handleDisconnect);
    socket.on("connect", handleReconnect);

    return () => {
      socket.off("disconnect", handleDisconnect);
      socket.off("connect", handleReconnect);
    };
  }, [joined, channelId, serverId, muted, deafened, cleanupPeers]);

  // ICE restart on peer connection failure
  useEffect(() => {
    if (!joined) return;
    const interval = setInterval(() => {
      peersRef.current.forEach((pc, socketId) => {
        if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
          console.log("[Voice] ICE restart for peer:", socketId);
          pc.restartIce();
          pc.createOffer({ iceRestart: true })
            .then((offer) => pc.setLocalDescription(offer))
            .then(() => {
              const socket = getSocket();
              socket.emit("voice:offer", { to: socketId, offer: pc.localDescription! });
            })
            .catch((err) => console.error("[Voice] ICE restart failed:", err));
        }
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [joined]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (joinedChannelRef.current) {
        const socket = getSocket();
        socket.emit("voice:leave", joinedChannelRef.current);
        stopVAD();
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        cleanupPeers();
      }
    };
  }, [cleanupPeers, stopVAD]);

  // VoicePanel is now a headless WebRTC engine — VoiceRoom handles the UI
  return null;
});

export default VoicePanel;
