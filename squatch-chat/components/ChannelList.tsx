"use client";

import { useState, useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { displayName } from "@/lib/utils";
import { useMutedChannels } from "@/hooks/useMutedChannels";

interface Channel {
  id: string;
  name: string;
  type?: string;
  category?: string | null;
  description?: string;
  position?: number;
}

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
}

interface ChannelListProps {
  serverName: string;
  serverBanner?: string | null;
  channels: Channel[];
  activeChannelId?: string;
  serverId: string;
  unreadCounts?: Map<string, number>;
  currentUserId?: string;
  currentUserRole?: string;
  activeVoiceChannelId?: string | null;
  voiceParticipants?: Map<string, VoiceParticipant[]>;
  onChannelSelect: (channel: Channel) => void;
  onChannelCreated: (channel: Channel) => void;
  onVoiceJoin?: (channel: Channel) => void;
  onVoiceLeave?: () => void;
  onServerRenamed?: (newName: string) => void;
  onServerDeleted?: () => void;
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

function MuteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-[var(--muted)] opacity-50 shrink-0">
      <path d="M3.27 3L2 4.27l9 9V21l4-4h4l1 1V3.27L3.27 3zM19 15.73L4.27 1 3 2.27l16 16 .73-.73L19 15.73z"/>
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
  serverBanner,
  channels,
  activeChannelId,
  serverId,
  unreadCounts,
  currentUserId,
  currentUserRole,
  activeVoiceChannelId,
  voiceParticipants,
  onChannelSelect,
  onChannelCreated,
  onVoiceJoin,
  onVoiceLeave,
  onServerRenamed,
  onServerDeleted,
}: ChannelListProps) {
  const [creating, setCreating] = useState<"text" | "voice" | null>(null);
  const [newName, setNewName] = useState("");
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [renameValue, setRenameValue] = useState(serverName);
  const [settingsError, setSettingsError] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [localVoiceParticipants, setLocalVoiceParticipants] = useState<Map<string, VoiceParticipant[]>>(
    voiceParticipants || new Map()
  );
  const { toggleMute, isMuted } = useMutedChannels();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [localChannels, setLocalChannels] = useState<Channel[]>(channels);
  const [focusedChannelIndex, setFocusedChannelIndex] = useState<number>(-1);

  // Sync localChannels when parent channels prop changes
  useEffect(() => {
    setLocalChannels(channels);
  }, [channels]);

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
      body: JSON.stringify({ serverId, name: newName.trim(), type: creating, category: newCategory.trim() || undefined }),
    });

    if (res.ok) {
      const { channel } = await res.json();
      onChannelCreated(channel);
      setNewName("");
      setNewCategory("");
      setCreating(null);
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!renameValue.trim() || renameValue.trim() === serverName || settingsLoading) return;
    setSettingsLoading(true);
    setSettingsError("");
    const res = await fetch(`/api/servers/${serverId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    setSettingsLoading(false);
    if (res.ok) {
      onServerRenamed?.(renameValue.trim());
      setShowServerSettings(false);
    } else {
      const data = await res.json();
      setSettingsError(data.error || "Failed to rename");
    }
  }

  async function handleRegenerateInvite() {
    if (settingsLoading) return;
    setSettingsLoading(true);
    setSettingsError("");
    const res = await fetch(`/api/servers/${serverId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regenerateInvite: true }),
    });
    setSettingsLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setSettingsError(data.error || "Failed");
    }
  }

  async function handleDeleteServer() {
    if (!confirm(`Delete "${serverName}" permanently? This cannot be undone.`)) return;
    setSettingsLoading(true);
    const res = await fetch(`/api/servers/${serverId}`, { method: "DELETE" });
    setSettingsLoading(false);
    if (res.ok) {
      onServerDeleted?.();
    } else {
      const data = await res.json();
      setSettingsError(data.error || "Failed to delete");
    }
  }

  function toggleCategory(cat: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  const isAdminOrOwner = currentUserRole === "owner" || currentUserRole === "admin";

  const sortedLocalChannels = [...localChannels].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const textChannels = sortedLocalChannels.filter((c) => !c.type || c.type === "text");
  const voiceChannels = sortedLocalChannels.filter((c) => c.type === "voice");

  // Group text channels by category
  const categoryMap = new Map<string, Channel[]>();
  for (const ch of textChannels) {
    const cat = ch.category || "";
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(ch);
  }
  // Sort: uncategorized ("") last
  const sortedCategories = Array.from(categoryMap.keys()).sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    return a.localeCompare(b);
  });

  // Flat list of navigable channels for keyboard nav (visible text channels first, then voice)
  const navigableChannels: Channel[] = [
    ...sortedCategories.flatMap((cat) =>
      collapsedCategories.has(cat) ? [] : categoryMap.get(cat)!
    ),
    ...voiceChannels,
  ];

  function handleChannelListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedChannelIndex((prev) =>
        prev < navigableChannels.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedChannelIndex((prev) =>
        prev > 0 ? prev - 1 : navigableChannels.length - 1
      );
    } else if (e.key === "Enter" && focusedChannelIndex >= 0) {
      const focused = navigableChannels[focusedChannelIndex];
      if (focused) {
        if (focused.type === "voice") {
          if (activeVoiceChannelId === focused.id) {
            onVoiceLeave?.();
          } else {
            onVoiceJoin?.(focused);
          }
        } else {
          onChannelSelect(focused);
        }
      }
    }
  }

  async function handleChannelDrop(targetChannelId: string) {
    if (!draggingId || draggingId === targetChannelId) return;
    const currentOrder = sortedLocalChannels.map((c) => c.id);
    const fromIdx = currentOrder.indexOf(draggingId);
    const toIdx = currentOrder.indexOf(targetChannelId);
    const newOrder = [...currentOrder];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggingId);
    // Optimistic local update
    const reordered = newOrder.map((id) => localChannels.find((c) => c.id === id)!);
    setLocalChannels(reordered);
    setDraggingId(null);
    setDragOverId(null);
    await fetch("/api/channels/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelIds: newOrder, serverId }),
    });
  }

  return (
    <div
      className="w-60 bg-[var(--panel)] flex flex-col border-r border-[var(--accent-2)]/30 shrink-0 outline-none"
      tabIndex={0}
      onKeyDown={handleChannelListKeyDown}
      onBlur={() => setFocusedChannelIndex(-1)}
      aria-label="Channel list"
    >
      {serverBanner && (
        <div className="h-16 overflow-hidden shrink-0">
          <img src={serverBanner} alt="Server banner" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="h-12 px-4 flex items-center border-b border-[var(--accent-2)]/30 group/header">
        <h2 className="font-bold text-[var(--text)] truncate flex-1">{serverName}</h2>
        {currentUserRole === "owner" && (
          <button
            onClick={() => { setShowServerSettings((v) => !v); setRenameValue(serverName); setSettingsError(""); }}
            className="text-[var(--muted)] hover:text-[var(--text)] opacity-0 group-hover/header:opacity-100 transition-opacity shrink-0 ml-2"
            title="Server Settings"
            aria-label="Server settings"
            aria-expanded={showServerSettings}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
      </div>

      {/* Server settings panel */}
      {showServerSettings && currentUserRole === "owner" && (
        <div className="border-b border-[var(--accent-2)]/30 p-3 space-y-3 bg-[var(--panel-2)]/50">
          {settingsError && (
            <p className="text-xs text-[var(--danger)]">{settingsError}</p>
          )}
          <form onSubmit={handleRename} className="space-y-1">
            <label htmlFor="rename-server-input" className="text-xs font-semibold text-[var(--muted)] uppercase">Rename Server</label>
            <div className="flex gap-1">
              <input
                id="rename-server-input"
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="flex-1 text-xs px-2 py-1.5 bg-[var(--panel)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded focus:outline-none"
                maxLength={50}
              />
              <button
                type="submit"
                disabled={settingsLoading || !renameValue.trim() || renameValue.trim() === serverName}
                className="text-xs px-2 py-1.5 bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] transition-colors disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </form>
          <button
            onClick={handleRegenerateInvite}
            disabled={settingsLoading}
            className="w-full text-xs px-2 py-1.5 bg-[var(--panel)] text-[var(--muted)] border border-[var(--accent-2)]/30 rounded hover:text-[var(--text)] hover:border-[var(--accent-2)] transition-colors disabled:opacity-40"
          >
            Regenerate Invite Code
          </button>
          <button
            onClick={handleDeleteServer}
            disabled={settingsLoading}
            className="w-full text-xs px-2 py-1.5 bg-red-600/10 text-red-400 border border-red-600/20 rounded hover:bg-red-600/20 transition-colors disabled:opacity-40"
          >
            Delete Server
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2">
        {/* Text Channels grouped by category */}
        {(() => {
          let flatIndex = 0;
          return sortedCategories.map((cat) => {
            const catChannels = categoryMap.get(cat)!;
            const label = cat || "Text Channels";
            const isCollapsed = collapsedCategories.has(cat);
            return (
              <div key={cat}>
                <div className="px-2 mb-1 flex items-center justify-between mt-1">
                  <button
                    onClick={() => toggleCategory(cat)}
                    className="flex items-center gap-1 text-xs font-semibold text-[var(--muted)] uppercase tracking-wide hover:text-[var(--text)] transition-colors"
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label} category`}
                  >
                    <span className="text-[8px]">{isCollapsed ? "▶" : "▼"}</span>
                    {label}
                  </button>
                  {cat === "" && (
                    <button
                      onClick={() => setCreating("text")}
                      className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
                      title="Create Text Channel"
                      aria-label="Create channel"
                    >
                      +
                    </button>
                  )}
                </div>
                {!isCollapsed && catChannels.map((channel) => {
                  const navIdx = flatIndex++;
                  const isFocused = focusedChannelIndex === navIdx;
                  const unread = unreadCounts?.get(channel.id) || 0;
                  const muted = isMuted(channel.id);
                  const showBadge = !muted && unread > 0;
                  return (
                    <button
                      key={channel.id}
                      onClick={() => onChannelSelect(channel)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        toggleMute(channel.id);
                      }}
                      title={channel.description || undefined}
                      aria-label={`#${channel.name}${unread > 0 && !muted ? `, ${unread} unread` : ""}${muted ? ", muted" : ""}`}
                      aria-current={activeChannelId === channel.id ? "page" : undefined}
                      draggable={isAdminOrOwner}
                      onDragStart={isAdminOrOwner ? () => setDraggingId(channel.id) : undefined}
                      onDragOver={isAdminOrOwner ? (e) => { e.preventDefault(); setDragOverId(channel.id); } : undefined}
                      onDragEnd={isAdminOrOwner ? () => { setDraggingId(null); setDragOverId(null); } : undefined}
                      onDrop={isAdminOrOwner ? () => handleChannelDrop(channel.id) : undefined}
                      className={`w-full text-left px-2 py-1 rounded text-sm flex items-center gap-1.5 ${
                        activeChannelId === channel.id
                          ? "bg-[var(--panel-2)] text-[var(--text)]"
                          : showBadge
                            ? "text-[var(--text)] font-semibold hover:bg-[var(--panel-2)]/50"
                            : "text-[var(--muted)] hover:bg-[var(--panel-2)]/50 hover:text-[var(--text)]"
                      } ${dragOverId === channel.id && draggingId !== channel.id ? "opacity-50" : ""} ${
                        isFocused ? "ring-1 ring-[var(--accent)]/50" : ""
                      }`}
                    >
                      <HashIcon />
                      <span className="flex-1 truncate">{channel.name}</span>
                      {muted && <MuteIcon />}
                      {showBadge && (
                        <span className="ml-auto bg-[var(--accent)] text-[var(--bg)] text-xs font-bold rounded-full min-w-[1.25rem] h-5 flex items-center justify-center px-1">
                          {unread > 99 ? "99+" : unread}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          });
        })()}

        {/* Add channel button (when no uncategorized section exists) */}
        {!categoryMap.has("") && (
          <div className="px-2 mb-1 flex items-center justify-between mt-1">
            <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">Text Channels</span>
            <button
              onClick={() => setCreating("text")}
              className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
              title="Create Text Channel"
            >
              +
            </button>
          </div>
        )}

        {creating === "text" && (
          <form onSubmit={handleCreate} className="px-2 mb-1 space-y-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="channel-name (Enter to save)"
              className="w-full text-sm px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Escape") setCreating(null); }}
            />
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Category (optional)"
              className="w-full text-xs px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded focus:outline-none"
              onKeyDown={(e) => { if (e.key === "Escape") setCreating(null); }}
            />
            <div className="flex gap-1">
              <button type="submit" disabled={!newName.trim()} className="flex-1 text-xs py-1 bg-amber-600/30 text-amber-300 rounded hover:bg-amber-600/40 disabled:opacity-30 transition-colors">Create</button>
              <button type="button" onClick={() => setCreating(null)} className="text-xs py-1 px-2 text-[var(--muted)] hover:text-[var(--text)]">Cancel</button>
            </div>
          </form>
        )}

        {/* Voice Channels */}
        <div className="px-2 mb-1 mt-4 flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
            Voice Channels
          </span>
          <button
            onClick={() => setCreating("voice")}
            className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
            title="Create Voice Channel"
            aria-label="Create voice channel"
          >
            +
          </button>
        </div>

        {creating === "voice" && (
          <form onSubmit={handleCreate} className="px-2 mb-1 space-y-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="voice-channel (Enter to save)"
              className="w-full text-sm px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Escape") setCreating(null); }}
            />
            <div className="flex gap-1">
              <button type="submit" disabled={!newName.trim()} className="flex-1 text-xs py-1 bg-amber-600/30 text-amber-300 rounded hover:bg-amber-600/40 disabled:opacity-30 transition-colors">Create</button>
              <button type="button" onClick={() => setCreating(null)} className="text-xs py-1 px-2 text-[var(--muted)] hover:text-[var(--text)]">Cancel</button>
            </div>
          </form>
        )}

        {voiceChannels.length === 0 && !creating && (
          <div className="px-2 text-xs text-[var(--muted)] italic">
            No voice channels yet
          </div>
        )}

        {voiceChannels.map((channel, voiceIdx) => {
          const navIdx = textChannels.length + voiceIdx;
          const isFocused = focusedChannelIndex === navIdx;
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
                aria-label={isActive ? `Leave ${channel.name} voice channel` : `Join ${channel.name} voice channel`}
                aria-pressed={isActive}
                className={`w-full text-left px-2 py-1 rounded text-sm flex items-center gap-1.5 ${
                  isActive
                    ? "bg-green-600/20 text-green-400"
                    : "text-[var(--muted)] hover:bg-[var(--panel-2)]/50 hover:text-[var(--text)]"
                } ${isFocused ? "ring-1 ring-[var(--accent)]/50" : ""}`}
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
                      <span className="truncate">{displayName(p.username)}</span>
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
