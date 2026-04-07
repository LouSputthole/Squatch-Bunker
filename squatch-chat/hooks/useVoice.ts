"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSocket } from "@/lib/socket";
import type { Channel, Server, VoiceParticipant } from "@/types/chat";
import type { VoicePanelHandle } from "@/components/VoicePanel";

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

export function useVoice(activeServer: Server | null) {
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<Channel | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<Map<string, VoiceParticipant[]>>(new Map());
  const [voiceState, setVoiceState] = useState({ muted: false, deafened: false, reconnecting: false, participants: [] as VoiceParticipant[] });
  const [pttMode, setPttMode] = useState(false);
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

  // Auto-rejoin last voice channel when server changes
  useEffect(() => {
    if (!activeServer) return;
    const stored = loadLastVoice();
    if (!stored || stored.serverId !== activeServer.id) return;
    const voiceChannel = activeServer.channels.find(
      (c) => c.id === stored.channelId && c.type === "voice"
    );
    if (voiceChannel) {
      setActiveVoiceChannel(voiceChannel);
    }
  }, [activeServer]);

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
  const setInputSensitivity = useCallback((threshold: number) => {
    voicePanelRef.current?.setInputSensitivity(threshold);
  }, []);

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
    setInputSensitivity,
  };
}
