"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getSocket } from "@/lib/socket";
import type { Channel, Server, VoiceParticipant } from "@/types/chat";
import type { VoicePanelHandle } from "@/components/VoicePanel";

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
  }, []);

  const leaveVoice = useCallback(() => {
    setActiveVoiceChannel(null);
  }, []);

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
