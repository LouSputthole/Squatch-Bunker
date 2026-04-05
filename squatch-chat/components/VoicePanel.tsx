"use client";

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { getSocket } from "@/lib/socket";

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
}

interface VoicePanelProps {
  channelId: string;
  channelName: string;
  serverId: string;
  currentUserId: string;
  onParticipantsChange?: (channelId: string, participants: VoiceParticipant[]) => void;
  onDisconnect?: () => void;
  onStateChange?: (state: { muted: boolean; deafened: boolean; participants: VoiceParticipant[] }) => void;
}

export interface VoicePanelHandle {
  toggleMute: () => void;
  toggleDeafen: () => void;
  disconnect: () => void;
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
  onStateChange,
}, ref) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [connecting, setConnecting] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const joinedChannelRef = useRef<string | null>(null);

  const cleanupPeers = useCallback(() => {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    audioElementsRef.current.forEach((el) => { el.srcObject = null; el.remove(); });
    audioElementsRef.current.clear();
  }, []);

  const createPeer = useCallback(
    (remoteSocketId: string, initiator: boolean) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      const socket = getSocket();

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        let audio = audioElementsRef.current.get(remoteSocketId);
        if (!audio) {
          audio = new Audio();
          audio.autoplay = true;
          audioElementsRef.current.set(remoteSocketId, audio);
        }
        audio.srcObject = stream;
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
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    cleanupPeers();
    joinedChannelRef.current = null;
    setJoined(false);
    setMuted(false);
    setDeafened(false);
    setParticipants([]);
    playNotificationSound("leave");
    onDisconnect?.();
  }, [cleanupPeers, onDisconnect]);

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
  }), [toggleMute, toggleDeafen, leaveVoice]);

  // Report state changes to parent
  useEffect(() => {
    onStateChange?.({ muted, deafened, participants });
  }, [muted, deafened, participants, onStateChange]);

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
        if (p.userId !== currentUserId) createPeer(p.socketId, true);
      });
    }

    function handleUserJoined(data: { channelId: string; userId: string; socketId: string }) {
      if (data.channelId !== channelId || data.userId === currentUserId) return;
      playNotificationSound("join");
    }

    function handleUserLeft(data: { channelId: string; socketId: string }) {
      if (data.channelId !== channelId) return;
      playNotificationSound("leave");
      const pc = peersRef.current.get(data.socketId);
      if (pc) { pc.close(); peersRef.current.delete(data.socketId); }
      const audio = audioElementsRef.current.get(data.socketId);
      if (audio) { audio.srcObject = null; audio.remove(); audioElementsRef.current.delete(data.socketId); }
    }

    function handleOffer(data: { from: string; offer: RTCSessionDescriptionInit }) {
      const pc = createPeer(data.from, false);
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (joinedChannelRef.current) {
        const socket = getSocket();
        socket.emit("voice:leave", joinedChannelRef.current);
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        cleanupPeers();
      }
    };
  }, [cleanupPeers]);

  // VoicePanel is now a headless WebRTC engine — VoiceRoom handles the UI
  return null;
});

export default VoicePanel;
