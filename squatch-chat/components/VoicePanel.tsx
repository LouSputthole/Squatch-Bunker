"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSocket } from "@/lib/socket";

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
}

interface VoicePanelProps {
  channelId: string;
  channelName: string;
  currentUserId: string;
}

// ICE servers for NAT traversal
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export default function VoicePanel({
  channelId,
  channelName,
  currentUserId,
}: VoicePanelProps) {
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [connecting, setConnecting] = useState(false);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const joinedChannelRef = useRef<string | null>(null);

  // Cleanup all peer connections
  const cleanupPeers = useCallback(() => {
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    audioElementsRef.current.forEach((el) => {
      el.srcObject = null;
      el.remove();
    });
    audioElementsRef.current.clear();
  }, []);

  // Create a peer connection for a remote user
  const createPeer = useCallback(
    (remoteSocketId: string, initiator: boolean) => {
      const pc = new RTCPeerConnection(ICE_SERVERS);
      const socket = getSocket();

      // Add local audio tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // Handle incoming remote audio
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

      // Send ICE candidates to the remote peer
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("voice:ice-candidate", {
            to: remoteSocketId,
            candidate: event.candidate.toJSON(),
          });
        }
      };

      // If we're the initiator, create and send an offer
      if (initiator) {
        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            socket.emit("voice:offer", {
              to: remoteSocketId,
              offer: pc.localDescription!,
            });
          });
      }

      peersRef.current.set(remoteSocketId, pc);
      return pc;
    },
    []
  );

  // Join voice channel
  const joinVoice = useCallback(async () => {
    setConnecting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      localStreamRef.current = stream;

      const socket = getSocket();
      socket.emit("voice:join", channelId);
      joinedChannelRef.current = channelId;
      setJoined(true);
    } catch (err) {
      console.error("[Voice] Failed to get microphone:", err);
      alert("Could not access microphone. Please check permissions.");
    } finally {
      setConnecting(false);
    }
  }, [channelId]);

  // Leave voice channel
  const leaveVoice = useCallback(() => {
    const socket = getSocket();
    if (joinedChannelRef.current) {
      socket.emit("voice:leave", joinedChannelRef.current);
    }

    // Stop local mic
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;

    cleanupPeers();
    joinedChannelRef.current = null;
    setJoined(false);
    setMuted(false);
    setDeafened(false);
    setParticipants([]);
  }, [cleanupPeers]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (!localStreamRef.current) return;
    const newMuted = !muted;
    localStreamRef.current.getAudioTracks().forEach((t) => {
      t.enabled = !newMuted;
    });
    setMuted(newMuted);
    const socket = getSocket();
    socket.emit("voice:mute", { channelId, muted: newMuted });
  }, [muted, channelId]);

  // Toggle deafen
  const toggleDeafen = useCallback(() => {
    const newDeafened = !deafened;
    setDeafened(newDeafened);
    // Mute all remote audio elements
    audioElementsRef.current.forEach((audio) => {
      audio.muted = newDeafened;
    });
    // Also mute self when deafening
    if (newDeafened && !muted) {
      toggleMute();
    }
  }, [deafened, muted, toggleMute]);

  // Socket event handlers for voice
  useEffect(() => {
    if (!joined) return;
    const socket = getSocket();

    // When we get the list of existing participants, create peer connections to each
    function handleParticipants(data: {
      channelId: string;
      participants: { userId: string; username: string; socketId: string; muted: boolean }[];
    }) {
      if (data.channelId !== channelId) return;
      // Create offers to all existing participants
      data.participants.forEach((p) => {
        if (p.userId !== currentUserId) {
          createPeer(p.socketId, true);
        }
      });
    }

    // When a new user joins, they'll send us an offer — we wait for it
    function handleUserJoined(data: {
      channelId: string;
      userId: string;
      username: string;
      socketId: string;
    }) {
      if (data.channelId !== channelId || data.userId === currentUserId) return;
      // The new joiner will send offers to us (they initiate), so we just prepare
    }

    // When a user leaves, close their peer connection
    function handleUserLeft(data: { channelId: string; userId: string; socketId: string }) {
      if (data.channelId !== channelId) return;
      const pc = peersRef.current.get(data.socketId);
      if (pc) {
        pc.close();
        peersRef.current.delete(data.socketId);
      }
      const audio = audioElementsRef.current.get(data.socketId);
      if (audio) {
        audio.srcObject = null;
        audio.remove();
        audioElementsRef.current.delete(data.socketId);
      }
    }

    // Handle incoming WebRTC offer
    function handleOffer(data: {
      from: string;
      fromUserId: string;
      fromUsername: string;
      offer: RTCSessionDescriptionInit;
    }) {
      const pc = createPeer(data.from, false);
      pc.setRemoteDescription(new RTCSessionDescription(data.offer))
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .then(() => {
          socket.emit("voice:answer", {
            to: data.from,
            answer: pc.localDescription!,
          });
        });
    }

    // Handle incoming WebRTC answer
    function handleAnswer(data: { from: string; answer: RTCSessionDescriptionInit }) {
      const pc = peersRef.current.get(data.from);
      if (pc) {
        pc.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    }

    // Handle incoming ICE candidate
    function handleIceCandidate(data: { from: string; candidate: RTCIceCandidateInit }) {
      const pc = peersRef.current.get(data.from);
      if (pc) {
        pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      }
    }

    // Participant list updates (for UI display)
    function handleParticipantsUpdate(data: {
      channelId: string;
      participants: VoiceParticipant[];
    }) {
      if (data.channelId !== channelId) return;
      setParticipants(data.participants);
    }

    socket.on("voice:participants", handleParticipants);
    socket.on("voice:user-joined", handleUserJoined);
    socket.on("voice:user-left", handleUserLeft);
    socket.on("voice:offer", handleOffer);
    socket.on("voice:answer", handleAnswer);
    socket.on("voice:ice-candidate", handleIceCandidate);
    socket.on("voice:participants-update", handleParticipantsUpdate);

    return () => {
      socket.off("voice:participants", handleParticipants);
      socket.off("voice:user-joined", handleUserJoined);
      socket.off("voice:user-left", handleUserLeft);
      socket.off("voice:offer", handleOffer);
      socket.off("voice:answer", handleAnswer);
      socket.off("voice:ice-candidate", handleIceCandidate);
      socket.off("voice:participants-update", handleParticipantsUpdate);
    };
  }, [joined, channelId, currentUserId, createPeer]);

  // Cleanup on unmount or channel change
  useEffect(() => {
    return () => {
      if (joinedChannelRef.current) {
        const socket = getSocket();
        socket.emit("voice:leave", joinedChannelRef.current);
        localStreamRef.current?.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
        cleanupPeers();
        joinedChannelRef.current = null;
      }
    };
  }, [channelId, cleanupPeers]);

  // Listen for participant updates even when not joined (to show who's in voice)
  useEffect(() => {
    if (joined) return; // Already handled above
    const socket = getSocket();

    function handleParticipantsUpdate(data: {
      channelId: string;
      participants: VoiceParticipant[];
    }) {
      if (data.channelId !== channelId) return;
      setParticipants(data.participants);
    }

    socket.on("voice:participants-update", handleParticipantsUpdate);
    return () => {
      socket.off("voice:participants-update", handleParticipantsUpdate);
    };
  }, [joined, channelId]);

  return (
    <div className="border-t border-[var(--accent-2)]/30 bg-[var(--panel)]">
      {/* Participant list */}
      {participants.length > 0 && (
        <div className="px-3 py-2 border-b border-[var(--accent-2)]/20">
          <div className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-1">
            Voice Connected — {participants.length}
          </div>
          {participants.map((p) => (
            <div key={p.userId} className="flex items-center gap-2 py-0.5">
              <div
                className={`w-2 h-2 rounded-full ${
                  p.muted ? "bg-[var(--muted)]" : "bg-green-500"
                }`}
              />
              <span
                className={`text-sm truncate ${
                  p.userId === currentUserId
                    ? "text-[var(--accent)]"
                    : "text-[var(--text)]"
                }`}
              >
                {p.username}
              </span>
              {p.muted && (
                <span className="text-xs text-[var(--muted)]" title="Muted">
                  [muted]
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Controls */}
      <div className="px-3 py-2 flex items-center gap-2">
        {!joined ? (
          <button
            onClick={joinVoice}
            disabled={connecting}
            className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-semibold rounded transition-colors"
          >
            {connecting ? "Connecting..." : `Join Voice`}
          </button>
        ) : (
          <>
            <button
              onClick={toggleMute}
              className={`px-3 py-2 text-sm font-semibold rounded transition-colors ${
                muted
                  ? "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                  : "bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)]/30"
              }`}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={toggleDeafen}
              className={`px-3 py-2 text-sm font-semibold rounded transition-colors ${
                deafened
                  ? "bg-red-600/20 text-red-400 hover:bg-red-600/30"
                  : "bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)]/30"
              }`}
              title={deafened ? "Undeafen" : "Deafen"}
            >
              {deafened ? "Undeafen" : "Deafen"}
            </button>
            <button
              onClick={leaveVoice}
              className="px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded transition-colors ml-auto"
            >
              Disconnect
            </button>
          </>
        )}
      </div>
    </div>
  );
}
