"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSocket } from "@/lib/socket";
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
  const [lastCheckedVoiceServer, setLastCheckedVoiceServer] = useState<Server | null>(activeServer);
  const [voiceParticipants, setVoiceParticipants] = useState<Map<string, VoiceParticipant[]>>(new Map());
  const [voiceState, setVoiceState] = useState({ muted: false, deafened: false, reconnecting: false, sharing: false, cameraOn: false, participants: [] as VoiceParticipant[] });
  const [pttMode, setPttMode] = useState(false);
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
  if (lastCheckedVoiceServer !== activeServer) {
    setLastCheckedVoiceServer(activeServer);
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

  const toggleMute = useCallback(() => voicePanelRef.current?.toggleMute(), []);
  const toggleDeafen = useCallback(() => voicePanelRef.current?.toggleDeafen(), []);
  const disconnect = useCallback(() => voicePanelRef.current?.disconnect(), []);
  const togglePTT = useCallback(() => {
    voicePanelRef.current?.togglePTT();
    setPttMode((p) => !p);
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

    function handleForceMute(data: { muted: boolean; by: string }) {
      if (data.muted) voicePanelRef.current?.forceMute?.();
      setVoiceState((prev) => ({ ...prev, muted: data.muted }));
    }
    function handleForceDeafen(data: { deafened: boolean; by: string }) {
      if (data.deafened) voicePanelRef.current?.forceDeafen?.();
      setVoiceState((prev) => ({ ...prev, deafened: data.deafened, muted: data.deafened || prev.muted }));
    }
    function handleKicked() {
      setActiveVoiceChannel(null);
    }
    function handleMoved(data: { toChannelId: string }) {
      // Find the channel in the active server and switch to it
      if (activeServer) {
        const target = activeServer.channels.find((c) => c.id === data.toChannelId);
        if (target) setActiveVoiceChannel(target);
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
