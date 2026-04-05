"use client";

import { useState, useEffect } from "react";
import { getSocket } from "@/lib/socket";

interface Channel {
  id: string;
  name: string;
  type?: string;
}

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
}

interface ChannelListProps {
  serverName: string;
  channels: Channel[];
  activeChannelId?: string;
  serverId: string;
  unreadCounts?: Map<string, number>;
  currentUserId?: string;
  activeVoiceChannelId?: string | null;
  voiceParticipants?: Map<string, VoiceParticipant[]>;
  onChannelSelect: (channel: Channel) => void;
  onChannelCreated: (channel: Channel) => void;
  onVoiceJoin?: (channel: Channel) => void;
  onVoiceLeave?: () => void;
}

// SVG Icons
function HashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--accent-2)]">
      <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" /><line x1="10" y1="3" x2="8" y2="21" /><line x1="16" y1="3" x2="14" y2="21" />
    </svg>
  );
}

function SpeakerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--accent-2)]">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}

function MicOffIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
      <line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.35 2.17" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function HeadphonesOffIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
      <line x1="1" y1="1" x2="23" y2="23" /><path d="M3 18v-6a9 9 0 0 1 14.12-7.41" /><path d="M21 12v6" /><path d="M3 18a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3v-1" /><path d="M15 17v1a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3" />
    </svg>
  );
}

export default function ChannelList({
  serverName,
  channels,
  activeChannelId,
  serverId,
  unreadCounts,
  currentUserId,
  activeVoiceChannelId,
  voiceParticipants,
  onChannelSelect,
  onChannelCreated,
  onVoiceJoin,
  onVoiceLeave,
}: ChannelListProps) {
  const [creating, setCreating] = useState<"text" | "voice" | null>(null);
  const [newName, setNewName] = useState("");
  const [localVoiceParticipants, setLocalVoiceParticipants] = useState<Map<string, VoiceParticipant[]>>(
    voiceParticipants || new Map()
  );

  // Sync with parent prop
  useEffect(() => {
    if (voiceParticipants) setLocalVoiceParticipants(voiceParticipants);
  }, [voiceParticipants]);

  // Listen for voice participant updates for all voice channels in this server
  useEffect(() => {
    const socket = getSocket();
    const voiceChannels = channels.filter((c) => c.type === "voice");

    function handleVoiceUpdate(data: { channelId: string; participants: VoiceParticipant[] }) {
      if (!voiceChannels.some((c) => c.id === data.channelId)) return;
      setLocalVoiceParticipants((prev) => {
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
  }, [channels]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !creating) return;

    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, name: newName.trim(), type: creating }),
    });

    if (res.ok) {
      const { channel } = await res.json();
      onChannelCreated(channel);
      setNewName("");
      setCreating(null);
    }
  }

  const textChannels = channels.filter((c) => !c.type || c.type === "text");
  const voiceChannels = channels.filter((c) => c.type === "voice");

  return (
    <div className="w-60 bg-[var(--panel)] flex flex-col border-r border-[var(--accent-2)]/30 shrink-0">
      <div className="h-12 px-4 flex items-center border-b border-[var(--accent-2)]/30">
        <h2 className="font-bold text-[var(--text)] truncate">{serverName}</h2>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* Text Channels */}
        <div className="px-2 mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
            Text Channels
          </span>
          <button
            onClick={() => setCreating("text")}
            className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
            title="Create Text Channel"
          >
            +
          </button>
        </div>

        {creating === "text" && (
          <form onSubmit={handleCreate} className="px-2 mb-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="channel-name"
              className="w-full text-sm px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none"
              autoFocus
              onBlur={() => { if (!newName.trim()) setCreating(null); }}
            />
          </form>
        )}

        {textChannels.map((channel) => {
          const unread = unreadCounts?.get(channel.id) || 0;
          return (
            <button
              key={channel.id}
              onClick={() => onChannelSelect(channel)}
              className={`w-full text-left px-2 py-1 rounded text-sm flex items-center gap-1.5 ${
                activeChannelId === channel.id
                  ? "bg-[var(--panel-2)] text-[var(--text)]"
                  : unread > 0
                    ? "text-[var(--text)] font-semibold hover:bg-[var(--panel-2)]/50"
                    : "text-[var(--muted)] hover:bg-[var(--panel-2)]/50 hover:text-[var(--text)]"
              }`}
            >
              <HashIcon />
              <span className="flex-1 truncate">{channel.name}</span>
              {unread > 0 && (
                <span className="ml-auto bg-[var(--accent)] text-[var(--bg)] text-xs font-bold rounded-full min-w-[1.25rem] h-5 flex items-center justify-center px-1">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}

        {/* Voice Channels */}
        <div className="px-2 mb-1 mt-4 flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
            Voice Channels
          </span>
          <button
            onClick={() => setCreating("voice")}
            className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
            title="Create Voice Channel"
          >
            +
          </button>
        </div>

        {creating === "voice" && (
          <form onSubmit={handleCreate} className="px-2 mb-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="voice-channel"
              className="w-full text-sm px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none"
              autoFocus
              onBlur={() => { if (!newName.trim()) setCreating(null); }}
            />
          </form>
        )}

        {voiceChannels.length === 0 && !creating && (
          <div className="px-2 text-xs text-[var(--muted)] italic">
            No voice channels yet
          </div>
        )}

        {voiceChannels.map((channel) => {
          const isActive = activeVoiceChannelId === channel.id;
          const participants = localVoiceParticipants.get(channel.id) || [];
          return (
            <div key={channel.id}>
              <button
                onClick={() => {
                  if (isActive) {
                    onVoiceLeave?.();
                  } else {
                    onVoiceJoin?.(channel);
                  }
                }}
                className={`w-full text-left px-2 py-1 rounded text-sm flex items-center gap-1.5 ${
                  isActive
                    ? "bg-green-600/20 text-green-400"
                    : "text-[var(--muted)] hover:bg-[var(--panel-2)]/50 hover:text-[var(--text)]"
                }`}
              >
                <SpeakerIcon />
                <span className="flex-1 truncate">{channel.name}</span>
                {participants.length > 0 && (
                  <span className="text-xs text-[var(--muted)]">{participants.length}</span>
                )}
              </button>

              {/* Show participants in voice channel */}
              {participants.length > 0 && (
                <div className="pl-7 pr-2">
                  {participants.map((p) => (
                    <div
                      key={p.userId}
                      className={`flex items-center gap-1.5 py-0.5 text-xs ${
                        p.userId === currentUserId ? "text-[var(--accent)]" : "text-[var(--text)]"
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        p.muted ? "bg-red-400" : "bg-green-500"
                      }`} />
                      <span className="truncate">{p.username}</span>
                      {p.muted && <MicOffIcon />}
                      {p.deafened && <HeadphonesOffIcon />}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
