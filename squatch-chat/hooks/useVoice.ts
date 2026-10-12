"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSocket } from "@/lib/socket";
import { toast } from "@/lib/toast";
import type { Channel, Server, VoiceParticipant } from "@/types/chat";
import type { VoicePanelHandle, ScreenShareInfo } from "@/components/VoicePanel";

const VOICE_STORAGE_KEY = "squatch:lastVoice";

interface StoredVoice { channelId: string; channelName: string; serverId: string }

function saveLastVoice(channel: Channel, serverId: string) {
  try {
    const val: StoredVoice = { channelId: channel.id, channelName: channel.name, serverId };
    localStorage.setItem(VOICE_STORAGE_KEY, JSON.stringify(val));
  } catch { /* ignore */ }
}

function clearLastVoice() {
  try { localStorage.removeItem(VOICE_STORAGE_KEY); } catch { /* ignore */ }
}

function loadLastVoice(): StoredVoice | null {
  try {
    const raw = localStorage.getItem(VOICE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function findStoredVoiceChannel(activeServer: Server | null): Channel | null {
  if (!activeServer) return null;
  const stored = loadLastVoice();
  if (!stored || stored.serverId !== activeServer.id) return null;
  return activeServer.channels.find(
    (channel) => channel.id === stored.channelId && channel.type === "voice"
  ) ?? null;
}

export function useVoice(activeServer: Server | null) {
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<Channel | null>(() =>
    findStoredVoiceChannel(activeServer)
  );
  const [lastCheckedVoiceServerId, setLastCheckedVoiceServerId] = useState<string | null>(activeServer?.id ?? null);
  const [voiceParticipants, setVoiceParticipants] = useState<Map<string, VoiceParticipant[]>>(new Map());
  const [voiceState, setVoiceState] = useState({ muted: false, deafened: false, reconnecting: false, sharing: false, cameraOn: false, serverMuted: false, serverDeafened: false, participants: [] as VoiceParticipant[] });
  // Push-to-talk lives here only; VoicePanel gets it as a prop so a remount
  // (channel switch, move, rejoin) cannot drop it while the button shows PTT.
  const [pttMode, setPttMode] = useState(false);
  const pttModeRef = useRef(false);
  const [incomingScreenShares, setIncomingScreenShares] = useState<ScreenShareInfo[]>([]);
  const [remoteVideoStreams, setRemoteVideoStreams] = useState<Map<string, MediaStream>>(new Map());
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const voicePanelRef = useRef<VoicePanelHandle>(null);

  // Global voice participants listener
  useEffect(() => {
    if (!activeServer) return;
    const socket = getSocket();

    function handleVoiceUpdate(data: { channelId: string; participants: VoiceParticipant[] }) {
      const voiceChannelIds = activeServer!.channels
        .filter((c) => c.type === "voice")
        .map((c) => c.id);
      if (!voiceChannelIds.includes(data.channelId)) return;

      setVoiceParticipants((prev) => {
        const next = new Map(prev);
        if (data.participants.length > 0) {
          next.set(data.channelId, data.participants);
        } else {
          next.delete(data.channelId);
        }
        return next;
      });
    }

    socket.on("voice:participants-update", handleVoiceUpdate);
    return () => { socket.off("voice:participants-update", handleVoiceUpdate); };
  }, [activeServer]);

  const joinVoice = useCallback((channel: Channel) => {
    setActiveVoiceChannel(channel);
    if (activeServer) saveLastVoice(channel, activeServer.id);
  }, [activeServer]);

  const leaveVoice = useCallback(() => {
    setActiveVoiceChannel(null);
    clearLastVoice();
  }, []);

  // Adjust during a server transition so restoration does not require an effect.
  // Keyed on the id: the server object is recreated on every channel edit, and
  // restoring on each of those re-joined users who had just been kicked.
  const activeServerId = activeServer?.id ?? null;
  if (lastCheckedVoiceServerId !== activeServerId) {
    setLastCheckedVoiceServerId(activeServerId);
    const storedVoiceChannel = findStoredVoiceChannel(activeServer);
    if (storedVoiceChannel) setActiveVoiceChannel(storedVoiceChannel);
  }

  const handleParticipantsChange = useCallback((channelId: string, participants: VoiceParticipant[]) => {
    setVoiceParticipants((prev) => {
      const next = new Map(prev);
      if (participants.length > 0) {
        next.set(channelId, participants);
      } else {
        next.delete(channelId);
      }
      return next;
    });
  }, []);

  const serverMutedNow = voiceState.muted && (voiceState.serverMuted || voiceState.serverDeafened);
  const toggleMute = useCallback(() => {
    if (serverMutedNow) {
      toast("A moderator has server-muted you.", "error");
      return;
    }
    voicePanelRef.current?.toggleMute();
  }, [serverMutedNow]);
  const toggleDeafen = useCallback(() => voicePanelRef.current?.toggleDeafen(), []);
  const disconnect = useCallback(() => voicePanelRef.current?.disconnect(), []);
  const togglePTT = useCallback(() => {
    const next = !pttModeRef.current;
    pttModeRef.current = next;
    setPttMode(next);
    voicePanelRef.current?.setPTT(next);
  }, []);
  const setUserVolume = useCallback((userId: string, volume: number) => {
    voicePanelRef.current?.setUserVolume(userId, volume);
  }, []);
  const setUserRoutingMuted = useCallback((userId: string, muted: boolean) => {
    voicePanelRef.current?.setUserRoutingMuted(userId, muted);
  }, []);
  const setInputSensitivity = useCallback((threshold: number) => {
    voicePanelRef.current?.setInputSensitivity(threshold);
  }, []);

  // ─── Soundboard ───
  const deafenedRef = useRef(false);
  useEffect(() => { deafenedRef.current = voiceState.deafened; }, [voiceState.deafened]);

  const playSound = useCallback((src: string, name?: string) => {
    if (!deafenedRef.current) { try { const a = new Audio(src); a.volume = 0.85; a.play().catch(() => {}); } catch { /* ignore */ } }
    if (activeVoiceChannel) getSocket().emit("soundboard:play", { channelId: activeVoiceChannel.id, src, name });
  }, [activeVoiceChannel]);

  // Play sounds others trigger in our voice channel (unless we're deafened).
  useEffect(() => {
    const socket = getSocket();
    function onSound(data: { src: string }) {
      if (deafenedRef.current) return;
      try { const a = new Audio(data.src); a.volume = 0.85; a.play().catch(() => {}); } catch { /* ignore */ }
    }
    socket.on("soundboard:play", onSound);
    return () => { socket.off("soundboard:play", onSound); };
  }, []);

  // ─── Screen Share ───

  const startScreenShare = useCallback(async () => {
    await voicePanelRef.current?.startScreenShare();
  }, []);

  const stopScreenShare = useCallback(() => {
    voicePanelRef.current?.stopScreenShare();
  }, []);

  const handleScreenShareChange = useCallback((shares: ScreenShareInfo[]) => {
    setIncomingScreenShares(shares);
  }, []);

  const toggleCamera = useCallback(async () => {
    await voicePanelRef.current?.toggleCamera();
  }, []);

  const handleVideoStreamsChange = useCallback((streams: Map<string, MediaStream>) => {
    setRemoteVideoStreams(new Map(streams));
  }, []);

  // Track local camera stream from voiceState
  useEffect(() => {
    const stream = voicePanelRef.current?.getLocalCameraStream?.() || null;
    setLocalCameraStream(stream);
  }, [voiceState.cameraOn]);

  // Track local screen stream from voiceState
  useEffect(() => {
    const stream = voicePanelRef.current?.getLocalScreenStream?.() || null;
    setLocalScreenStream(stream);
  }, [voiceState.sharing]);

  // ─── Mod Actions ───

  const serverMuteUser = useCallback((channelId: string, targetUserId: string, muted: boolean) => {
    getSocket().emit("mod:server-mute", { channelId, targetUserId, muted });
  }, []);

  const serverDeafenUser = useCallback((channelId: string, targetUserId: string, deafened: boolean) => {
    getSocket().emit("mod:server-deafen", { channelId, targetUserId, deafened });
  }, []);

  const kickFromVoice = useCallback((channelId: string, targetUserId: string) => {
    getSocket().emit("mod:kick-voice", { channelId, targetUserId });
  }, []);

  const moveUser = useCallback((fromChannelId: string, toChannelId: string, targetUserId: string) => {
    getSocket().emit("mod:move-user", { fromChannelId, toChannelId, targetUserId });
  }, []);

  // Listen for mod actions targeting us
  useEffect(() => {
    const socket = getSocket();

    // VoicePanel reports the real mute/deafen state back through onStateChange;
    // lifting a server mute never reopens the mic, it just allows unmuting.
    function handleForceMute(data: { muted: boolean; by: string }) {
      if (data.muted) {
        voicePanelRef.current?.forceMute?.();
        toast(`You were server-muted by ${data.by}.`, "error");
      } else {
        toast(`${data.by} lifted your server mute.`, "info");
      }
    }
    function handleForceDeafen(data: { deafened: boolean; by: string }) {
      if (data.deafened) {
        voicePanelRef.current?.forceDeafen?.();
        toast(`You were server-deafened by ${data.by}.`, "error");
      } else {
        toast(`${data.by} lifted your server deafen.`, "info");
      }
    }
    function handleKicked(data: { by?: string }) {
      // Forget the room too, or the next server re-render restores a live mic.
      clearLastVoice();
      setActiveVoiceChannel(null);
      toast(`You were disconnected from voice${data?.by ? ` by ${data.by}` : ""}.`, "error");
    }
    function handleMoved(data: { toChannelId: string; by?: string }) {
      // Find the channel in the active server and switch to it
      if (activeServer) {
        const target = activeServer.channels.find((c) => c.id === data.toChannelId);
        if (target) {
          saveLastVoice(target, activeServer.id);
          setActiveVoiceChannel(target);
          toast(`${data.by ?? "A moderator"} moved you to ${target.name}.`, "info");
        }
      }
    }

    socket.on("mod:force-mute", handleForceMute);
    socket.on("mod:force-deafen", handleForceDeafen);
    socket.on("mod:kicked-from-voice", handleKicked);
    socket.on("mod:moved-to-channel", handleMoved);

    return () => {
      socket.off("mod:force-mute", handleForceMute);
      socket.off("mod:force-deafen", handleForceDeafen);
      socket.off("mod:kicked-from-voice", handleKicked);
      socket.off("mod:moved-to-channel", handleMoved);
    };
  }, [activeServer]);

  return {
    activeVoiceChannel,
    voiceParticipants,
    voiceState,
    setVoiceState,
    pttMode,
    voicePanelRef,
    joinVoice,
    leaveVoice,
    handleParticipantsChange,
    toggleMute,
    toggleDeafen,
    disconnect,
    togglePTT,
    setUserVolume,
    setUserRoutingMuted,
    setInputSensitivity,
    playSound,
    serverMuteUser,
    serverDeafenUser,
    kickFromVoice,
    moveUser,
    startScreenShare,
    stopScreenShare,
    handleScreenShareChange,
    incomingScreenShares,
    toggleCamera,
    handleVideoStreamsChange,
    remoteVideoStreams,
    localCameraStream,
    localScreenStream,
  };
}
