"use client";

import Image from "next/image";
import { useState, useEffect, useMemo } from "react";
import { getSocket } from "@/lib/socket";
import { displayName } from "@/lib/utils";
import { useMutedChannels } from "@/hooks/useMutedChannels";
import InviteModal from "@/components/InviteModal";
import {
  VOICE_ROOM_MODES,
  VOICE_ROOM_SCENES,
  voiceRoomModeLabel,
} from "@/lib/voiceRoomConfig";

interface Channel {
  id: string;
  name: string;
  type?: string;
  category?: string | null;
  description?: string;
  position?: number;
  roomMode?: string;
  roomScene?: string;
  retentionDays?: number | null;
}

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
  speaking?: boolean;
}

interface ManagedInvite {
  inviteCode: string;
  inviteExpiresAt: string | null;
  inviteMaxUses: number | null;
  inviteUseCount: number;
  inviteRevokedAt: string | null;
}

interface ChannelListProps {
  serverName: string;
  serverBanner?: string | null;
  serverIcon?: string | null;
  channels: Channel[];
  activeChannelId?: string;
  serverId: string;
  inviteCode?: string;
  inviteExpiresAt?: string | null;
  inviteMaxUses?: number | null;
  inviteUseCount?: number;
  inviteRevokedAt?: string | null;
  memberCount?: number;
  unreadCounts?: Map<string, number>;
  currentUserId?: string;
  currentUserRole?: string;
  canManageChannels?: boolean;
  activeVoiceChannelId?: string | null;
  viewingVoiceRoom?: boolean;
  voiceParticipants?: Map<string, VoiceParticipant[]>;
  selfSpeaking?: boolean;
  onChannelSelect: (channel: Channel) => void;
  onChannelCreated: (channel: Channel) => void;
  onChannelsUpdated?: (channels: Channel[]) => void;
  onInviteUpdated?: (invite: ManagedInvite) => void;
  onChannelDeleted?: (channelId: string) => void;
  onVoiceJoin?: (channel: Channel) => void;
  onVoiceView?: (channel: Channel) => void;
  onOpenServerSettings?: () => void;
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
  serverIcon,
  channels,
  activeChannelId,
  serverId,
  inviteCode,
  inviteExpiresAt,
  inviteMaxUses,
  inviteUseCount,
  inviteRevokedAt,
  memberCount,
  unreadCounts,
  currentUserId,
  currentUserRole,
  canManageChannels = false,
  activeVoiceChannelId,
  viewingVoiceRoom,
  voiceParticipants,
  selfSpeaking,
  onChannelSelect,
  onChannelCreated,
  onChannelsUpdated,
  onInviteUpdated,
  onChannelDeleted,
  onVoiceJoin,
  onVoiceView,
  onOpenServerSettings,
}: ChannelListProps) {
  const [creating, setCreating] = useState<"text" | "voice" | null>(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteState, setInviteState] = useState({
    code: inviteCode,
    expiresAt: inviteExpiresAt,
    maxUses: inviteMaxUses,
    useCount: inviteUseCount ?? 0,
    revokedAt: inviteRevokedAt,
  });
  const [newRoomMode, setNewRoomMode] = useState("hangout");
  const [newRoomScene, setNewRoomScene] = useState("campfire");
  const [newCategory, setNewCategory] = useState("");
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set<string>();
    try {
      const saved = JSON.parse(localStorage.getItem("collapsed-categories") || "[]");
      return new Set<string>(Array.isArray(saved) ? saved : []);
    } catch {
      return new Set<string>();
    }
  });
  const [dragOverCategory, setDragOverCategory] = useState<string | null>(null);
  const [voiceParticipantState, setVoiceParticipantState] = useState(() => ({
    source: voiceParticipants,
    value: voiceParticipants || new Map<string, VoiceParticipant[]>(),
  }));
  const localVoiceParticipants = voiceParticipantState.source === voiceParticipants
    ? voiceParticipantState.value
    : voiceParticipants || new Map<string, VoiceParticipant[]>();
  const { toggleMute, isMuted } = useMutedChannels();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [channelState, setChannelState] = useState(() => ({ source: channels, value: channels }));
  const localChannels = channelState.source === channels ? channelState.value : channels;
  const [focusedChannelIndex, setFocusedChannelIndex] = useState<number>(-1);
  const [channelMenu, setChannelMenu] = useState<{ channel: Channel; x: number; y: number } | null>(null);

  function setLocalChannels(update: React.SetStateAction<Channel[]>) {
    setChannelState((current) => {
      const value = current.source === channels ? current.value : channels;
      return {
        source: channels,
        value: typeof update === "function" ? update(value) : update,
      };
    });
  }

  // Listen for voice participant updates for all voice channels in this server
  useEffect(() => {
    const socket = getSocket();
    const voiceChannels = channels.filter((c) => c.type === "voice");

    function handleVoiceUpdate(data: { channelId: string; participants: VoiceParticipant[] }) {
      if (!voiceChannels.some((c) => c.id === data.channelId)) return;
      setVoiceParticipantState((current) => {
        const value = current.source === voiceParticipants
          ? current.value
          : voiceParticipants || new Map<string, VoiceParticipant[]>();
        const next = new Map(value);
        if (data.participants.length > 0) {
          next.set(data.channelId, data.participants);
        } else {
          next.delete(data.channelId);
        }
        return { source: voiceParticipants, value: next };
      });
    }

    socket.on("voice:participants-update", handleVoiceUpdate);
    return () => { socket.off("voice:participants-update", handleVoiceUpdate); };
  }, [channels, voiceParticipants]);

  // Speaking indicators for the sidebar rows (only broadcast to members of the voice room)
  const [speakingIds, setSpeakingIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const socket = getSocket();
    function handleSpeaking(data: { userId: string; speaking: boolean }) {
      setSpeakingIds((prev) => {
        const next = new Set(prev);
        if (data.speaking) next.add(data.userId);
        else next.delete(data.userId);
        return next;
      });
    }
    socket.on("voice:speaking", handleSpeaking);
    return () => { socket.off("voice:speaking", handleSpeaking); };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!canManageChannels) {
      alert("You do not have permission to manage channels");
      setCreating(null);
      return;
    }
    if (!newName.trim() || !creating || createLoading) return;
    setCreateLoading(true);

    try {
      const res = await fetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serverId,
          name: newName.trim(),
          type: creating,
          category: newCategory.trim() || undefined,
          roomMode: creating === "voice" ? newRoomMode : undefined,
          roomScene: creating === "voice" ? newRoomScene : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Failed to create channel");
        return;
      }
      onChannelCreated(data.channel);
      setNewName("");
      setNewCategory("");
      setCreating(null);
    } catch {
      alert("Failed to create channel");
    } finally {
      setCreateLoading(false);
      setNewRoomMode("hangout");
      setNewRoomScene("campfire");
    }
  }

  function toggleCategory(cat: string) {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      if (typeof window !== "undefined") {
        localStorage.setItem("collapsed-categories", JSON.stringify(Array.from(next)));
      }
      return next;
    });
  }

  async function handleCategoryRename(cat: string, channels: Channel[]) {
    if (!canManageChannels) return;
    const newCat = window.prompt(`Rename category "${cat === "General" ? "General" : cat}" to:`, cat === "General" ? "" : cat);
    if (newCat === null) return; // cancelled
    const normalizedNew = newCat.trim() || null;
    const responses = await Promise.all(
      channels.map((ch) =>
        fetch(`/api/channels/${ch.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: normalizedNew }),
        })
      )
    );
    const failed = responses.find((response) => !response.ok);
    if (failed) {
      const data = await failed.json().catch(() => ({}));
      alert(data.error || "Failed to rename category");
      return;
    }
    onChannelsUpdated?.(channels.map((ch) => ({ ...ch, category: normalizedNew })));
  }

  async function handleDropOnCategory(targetCat: string) {
    if (!canManageChannels) return;
    if (!draggingId) return;
    const ch = localChannels.find((c) => c.id === draggingId);
    if (!ch) return;
    const newCat = targetCat === "General" ? null : targetCat;
    setLocalChannels((prev) =>
      prev.map((c) => (c.id === draggingId ? { ...c, category: newCat } : c))
    );
    setDraggingId(null);
    setDragOverCategory(null);
    const res = await fetch(`/api/channels/${draggingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: newCat }),
    });
    if (res.ok) {
      onChannelsUpdated?.([{ ...ch, category: newCat }]);
    } else {
      setLocalChannels(localChannels);
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to move channel");
    }
  }

  async function handleRenameChannel(channel: Channel) {
    if (!canManageChannels) return;
    const entered = window.prompt(`Rename ${channel.type === "voice" ? "" : "#"}${channel.name} to:`, channel.name);
    if (entered === null || !entered.trim() || entered.trim() === channel.name) return;
    const res = await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: entered.trim() }),
    });
    if (res.ok) {
      const { channel: updated } = await res.json();
      onChannelsUpdated?.([{ ...channel, name: updated.name }]);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to rename channel");
    }
  }


  async function handleConfigureVoiceRoom(channel: Channel) {
    if (!canManageChannels) return;
    const modeIds = VOICE_ROOM_MODES.map((mode) => mode.id).join(", ");
    const enteredMode = window.prompt(
      `Room purpose (${modeIds}):`,
      channel.roomMode || "hangout",
    );
    if (enteredMode === null) return;
    const mode = VOICE_ROOM_MODES.find((candidate) => candidate.id === enteredMode.trim());
    if (!mode) {
      alert("Unknown room purpose");
      return;
    }

    const sceneIds = VOICE_ROOM_SCENES.map((scene) => scene.id).join(", ");
    const enteredScene = window.prompt(
      `Shared scene (${sceneIds}):`,
      channel.roomScene || mode.defaultScene,
    );
    if (enteredScene === null) return;
    const scene = VOICE_ROOM_SCENES.find((candidate) => candidate.id === enteredScene.trim());
    if (!scene) {
      alert("Unknown room scene");
      return;
    }

    const res = await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomMode: mode.id, roomScene: scene.id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to update voice room");
      return;
    }
    const { channel: updated } = await res.json();
    onChannelsUpdated?.([{ ...channel, ...updated }]);
  }

  async function handleConfigureRetention(channel: Channel) {
    if (!canManageChannels) return;
    const entered = window.prompt(
      "Leave-no-trace retention (forever, 1, 7, or 30 days):",
      channel.retentionDays ? String(channel.retentionDays) : "forever",
    );
    if (entered === null) return;
    const normalized = entered.trim().toLowerCase();
    const retentionDays = normalized === "forever" || normalized === "none"
      ? null
      : Number(normalized);
    if (retentionDays !== null && ![1, 7, 30].includes(retentionDays)) {
      alert("Choose forever, 1, 7, or 30 days");
      return;
    }

    const response = await fetch(`/api/channels/${channel.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ retentionDays }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      alert(data.error || "Failed to update retention");
      return;
    }
    const { channel: updated } = await response.json();
    onChannelsUpdated?.([{ ...channel, ...updated }]);
  }

  async function handleDeleteChannel(channel: Channel) {
    if (!canManageChannels) return;
    if (!confirm(`Delete ${channel.type === "voice" ? "" : "#"}${channel.name}? All its messages will be permanently deleted.`)) return;
    const res = await fetch(`/api/channels/${channel.id}`, { method: "DELETE" });
    if (res.ok) {
      onChannelDeleted?.(channel.id);
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to delete channel");
    }
  }

  const canOpenServerSettings =
    currentUserRole === "owner" || currentUserRole === "admin";

  const sortedLocalChannels = useMemo(
    () => [...localChannels].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [localChannels],
  );
  const voiceChannels = sortedLocalChannels.filter((c) => c.type === "voice");

  // Group text channels by category using useMemo
  const { categoryMap, sortedCategories } = useMemo(() => {
    const textChannels = sortedLocalChannels.filter((c) => !c.type || c.type === "text");
    const map = new Map<string, Channel[]>();
    for (const ch of textChannels) {
      const cat = ch.category && ch.category.trim() ? ch.category.trim() : "General";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(ch);
    }
    const cats = Array.from(map.keys()).sort((a, b) => {
      if (a === "General") return -1;
      if (b === "General") return 1;
      return a.localeCompare(b);
    });
    return { categoryMap: map, sortedCategories: cats };
  }, [sortedLocalChannels]);

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
            onVoiceView?.(focused);
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
    if (!canManageChannels) return;
    if (!draggingId || draggingId === targetChannelId) return;
    const currentOrder = sortedLocalChannels.map((c) => c.id);
    const fromIdx = currentOrder.indexOf(draggingId);
    const toIdx = currentOrder.indexOf(targetChannelId);
    const newOrder = [...currentOrder];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggingId);
    // Optimistic local update — refresh position fields so the sort keeps the new order
    const reordered = newOrder.map((id, i) => ({ ...localChannels.find((c) => c.id === id)!, position: i }));
    setLocalChannels(reordered);
    setDraggingId(null);
    setDragOverId(null);
    const res = await fetch("/api/channels/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channelIds: newOrder, serverId }),
    });
    if (res.ok) {
      onChannelsUpdated?.(reordered);
    } else {
      setLocalChannels(localChannels);
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Failed to reorder channels");
    }
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
        <div className="relative h-16 overflow-hidden shrink-0">
          <Image
            src={serverBanner}
            alt="Server banner"
            fill
            sizes="15rem"
            className="object-cover"
            unoptimized
          />
        </div>
      )}
      <div className="h-12 px-4 flex items-center border-b border-[var(--accent-2)]/30 group/header">
        <h2 className="font-bold text-[var(--text)] truncate flex-1">{serverName}</h2>
        {inviteState.code && (
          <button
            onClick={() => setInviteOpen(true)}
            className="text-[var(--muted)] hover:text-[var(--text)] opacity-0 group-hover/header:opacity-100 transition-opacity shrink-0 ml-1"
            title="Invite People"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <line x1="19" y1="8" x2="19" y2="14" />
              <line x1="22" y1="11" x2="16" y2="11" />
            </svg>
          </button>
        )}
        {canOpenServerSettings && (
          <button
            onClick={() => onOpenServerSettings?.()}
            className="text-[var(--muted)] hover:text-[var(--text)] opacity-0 group-hover/header:opacity-100 transition-opacity shrink-0 ml-1"
            title="Server Settings"
            aria-label="Server settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* Text Channels grouped by category */}
        {sortedCategories.map((cat) => {
          const catChannels = categoryMap.get(cat)!;
          const label = cat || "Text Channels";
          const isCollapsed = collapsedCategories.has(cat);
          const isDragTarget = dragOverCategory === cat;
          return (
            <div key={cat}>
              {/* Category header */}
              <div
                className={`px-2 mb-0.5 flex items-center justify-between mt-2 rounded ${isDragTarget ? "border border-[var(--accent-2)] bg-[var(--panel-2)]/40" : "border border-transparent"}`}
                onDragOver={canManageChannels ? (e) => { e.preventDefault(); setDragOverCategory(cat); } : undefined}
                onDragLeave={canManageChannels ? () => setDragOverCategory(null) : undefined}
                onDrop={canManageChannels ? () => handleDropOnCategory(cat) : undefined}
              >
                <button
                  onClick={() => toggleCategory(cat)}
                  onContextMenu={canManageChannels ? (e) => { e.preventDefault(); handleCategoryRename(cat, catChannels); } : undefined}
                  className="flex items-center gap-1 text-xs uppercase tracking-wide font-semibold text-[var(--muted)] hover:text-[var(--text)] transition-colors flex-1 min-w-0"
                  title={canManageChannels ? "Right-click to rename category" : undefined}
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${label} category`}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={`shrink-0 transition-transform duration-150 ${isCollapsed ? "-rotate-90" : "rotate-0"}`}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  <span className="truncate">{cat}</span>
                  <span className="ml-1 font-normal opacity-60">({catChannels.length})</span>
                </button>
                {canManageChannels && (
                  <button
                    onClick={() => setCreating("text")}
                    className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none shrink-0 ml-1"
                    title="Create Text Channel"
                    aria-label="Create channel"
                  >
                    +
                  </button>
                )}
              </div>

              {!isCollapsed && (
                <ul role="list" aria-label={`${label} channels`}>
                  {catChannels.map((channel) => {
                    const unread = unreadCounts?.get(channel.id) || 0;
                    const muted = isMuted(channel.id);
                    const showBadge = !muted && unread > 0;
                    return (
                      <li key={channel.id} role="listitem">
                        <button
                          onClick={() => onChannelSelect(channel)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setChannelMenu({ channel, x: e.clientX, y: e.clientY });
                          }}
                          title={channel.description || undefined}
                          aria-label={`#${channel.name}${unread > 0 && !muted ? `, ${unread} unread` : ""}${muted ? ", muted" : ""}`}
                          aria-current={activeChannelId === channel.id ? "page" : undefined}
                          draggable={canManageChannels}
                          onDragStart={canManageChannels ? () => setDraggingId(channel.id) : undefined}
                          onDragOver={canManageChannels ? (e) => { e.preventDefault(); setDragOverId(channel.id); } : undefined}
                          onDragEnd={canManageChannels ? () => { setDraggingId(null); setDragOverId(null); } : undefined}
                          onDrop={canManageChannels ? () => handleChannelDrop(channel.id) : undefined}
                          className={`w-full text-left px-2 py-1 rounded text-sm flex items-center gap-1.5 ${
                            activeChannelId === channel.id
                              ? "bg-[var(--panel-2)] text-[var(--text)]"
                              : showBadge
                                ? "text-[var(--text)] font-semibold hover:bg-[var(--panel-2)]/50"
                                : "text-[var(--muted)] hover:bg-[var(--panel-2)]/50 hover:text-[var(--text)]"
                          } ${dragOverId === channel.id && draggingId !== channel.id ? "opacity-50" : ""}`}
                        >
                          <HashIcon />
                          <span className="flex-1 truncate">{channel.name}</span>
                          {channel.retentionDays && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300" title={`Messages disappear after ${channel.retentionDays} day(s)`}>
                              {channel.retentionDays === 1 ? "24h" : `${channel.retentionDays}d`}
                            </span>
                          )}
                          {muted && <MuteIcon />}
                          {showBadge && (
                            <span className="ml-auto bg-[var(--accent)] text-[var(--bg)] text-xs font-bold rounded-full min-w-[1.25rem] h-5 flex items-center justify-center px-1" aria-label={`${unread} unread messages`}>
                              {unread > 99 ? "99+" : unread}
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}

        {/* Add channel button (when no text channels at all yet) */}
        {sortedCategories.length === 0 && canManageChannels && (
          <div className="px-2 mb-1 flex items-center justify-between mt-1">
            <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">General</span>
            <button
              onClick={() => setCreating("text")}
              className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
              title="Create Text Channel"
            aria-label="Create channel"
            >
              +
            </button>
          </div>
        )}

        {canManageChannels && creating === "text" && (
          <form onSubmit={handleCreate} className="px-2 mb-1 space-y-1" aria-label="Create text channel">
            <label htmlFor="new-text-channel-name" className="sr-only">Channel name</label>
            <input
              id="new-text-channel-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="channel-name (Enter to save)"
              className="w-full text-sm px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Escape") setCreating(null); }}
            />
            <label htmlFor="new-text-channel-category" className="sr-only">Category (optional)</label>
            <input
              id="new-text-channel-category"
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="Category (optional)"
              className="w-full text-xs px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded focus:outline-none"
              onKeyDown={(e) => { if (e.key === "Escape") setCreating(null); }}
            />
            <div className="flex gap-1">
              <button type="submit" disabled={!newName.trim() || createLoading} className="flex-1 text-xs py-1 bg-amber-600/30 text-amber-300 rounded hover:bg-amber-600/40 disabled:opacity-30 transition-colors">Create</button>
              <button type="button" onClick={() => setCreating(null)} className="text-xs py-1 px-2 text-[var(--muted)] hover:text-[var(--text)]">Cancel</button>
            </div>
          </form>
        )}

        {/* Voice Channels */}
        <div className="px-2 mb-1 mt-4 flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
            Voice Channels
          </span>
          {canManageChannels && (
            <button
              onClick={() => setCreating("voice")}
              className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
              title="Create Voice Channel"
              aria-label="Create voice channel"
            >
              +
            </button>
          )}
        </div>

        {canManageChannels && creating === "voice" && (
          <form onSubmit={handleCreate} className="px-2 mb-1 space-y-1" aria-label="Create voice channel">
            <label htmlFor="new-voice-channel-name" className="sr-only">Voice channel name</label>
            <input
              id="new-voice-channel-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="voice-channel (Enter to save)"
              className="w-full text-sm px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Escape") setCreating(null); }}
            />
            <label className="block text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Purpose
              <select
                value={newRoomMode}
                onChange={(event) => {
                  const mode = VOICE_ROOM_MODES.find((candidate) => candidate.id === event.target.value);
                  if (!mode) return;
                  setNewRoomMode(mode.id);
                  setNewRoomScene(mode.defaultScene);
                }}
                className="mt-0.5 w-full text-xs px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded"
              >
                {VOICE_ROOM_MODES.map((mode) => (
                  <option key={mode.id} value={mode.id}>{mode.label}</option>
                ))}
              </select>
            </label>
            <label className="block text-[10px] uppercase tracking-wide text-[var(--muted)]">
              Shared scene
              <select
                value={newRoomScene}
                onChange={(event) => setNewRoomScene(event.target.value)}
                className="mt-0.5 w-full text-xs px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded"
              >
                {VOICE_ROOM_SCENES.map((scene) => (
                  <option key={scene.id} value={scene.id}>{scene.label}</option>
                ))}
              </select>
            </label>
            <p className="text-[10px] text-[var(--muted)] leading-tight">
              {VOICE_ROOM_MODES.find((mode) => mode.id === newRoomMode)?.description}
            </p>
            <div className="flex gap-1">
              <button type="submit" disabled={!newName.trim() || createLoading} className="flex-1 text-xs py-1 bg-amber-600/30 text-amber-300 rounded hover:bg-amber-600/40 disabled:opacity-30 transition-colors">Create</button>
              <button type="button" onClick={() => setCreating(null)} className="text-xs py-1 px-2 text-[var(--muted)] hover:text-[var(--text)]">Cancel</button>
            </div>
          </form>
        )}

        {voiceChannels.length === 0 && !creating && (
          <div className="px-2 text-xs text-[var(--muted)] italic">
            No voice channels yet
          </div>
        )}

        <ul role="list" aria-label="Voice channels">
          {voiceChannels.map((channel) => {
            const isActive = activeVoiceChannelId === channel.id;
            const isViewing = isActive && !!viewingVoiceRoom;
            const participants = localVoiceParticipants.get(channel.id) || [];
            return (
              <li key={channel.id} role="listitem">
                <button
                  onClick={() => {
                    if (isActive) {
                      onVoiceView?.(channel); // already connected — jump back into the room, don't leave
                    } else {
                      onVoiceJoin?.(channel);
                    }
                  }}
                  onContextMenu={canManageChannels ? (e) => {
                    e.preventDefault();
                    setChannelMenu({ channel, x: e.clientX, y: e.clientY });
                  } : undefined}
                  aria-label={isActive ? `Return to ${channel.name} voice room` : `Join ${channel.name} voice channel`}
                  aria-pressed={isActive}
                  className={`w-full text-left px-2 py-1 rounded text-sm flex items-center gap-1.5 ${
                    isActive
                      ? `bg-green-600/20 text-green-400${isViewing ? " ring-1 ring-green-400/50" : ""}`
                      : "text-[var(--muted)] hover:bg-[var(--panel-2)]/50 hover:text-[var(--text)]"
                  }`}
                >
                  <SpeakerIcon />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate">{channel.name}</span>
                    <span className="block text-[9px] opacity-60 truncate">{voiceRoomModeLabel(channel.roomMode)}</span>
                  </span>
                  {participants.length > 0 && (
                    <span className="text-xs text-[var(--muted)]" aria-label={`${participants.length} participants`}>{participants.length}</span>
                  )}
                </button>

                {/* Show participants in voice channel */}
                {participants.length > 0 && (
                  <ul role="list" aria-label={`Participants in ${channel.name}`} className="pl-7 pr-2">
                    {participants.map((p) => {
                      const isSpeaking = !p.muted && (
                        speakingIds.has(p.userId) || (p.userId === currentUserId && !!selfSpeaking)
                      );
                      return (
                        <li
                          key={p.userId}
                          role="listitem"
                          className={`flex items-center gap-1.5 py-0.5 text-xs ${
                            isSpeaking ? "text-amber-300" : p.userId === currentUserId ? "text-[var(--accent)]" : "text-[var(--text)]"
                          }`}
                        >
                          <div
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              p.muted ? "bg-red-400" : isSpeaking ? "bg-amber-400" : "bg-green-500"
                            }`}
                            style={isSpeaking ? { boxShadow: "0 0 6px rgba(251,191,36,0.9)" } : undefined}
                            aria-hidden="true"
                          />
                          <span className="truncate">{displayName(p.username)}</span>
                          {p.muted && <MicOffIcon />}
                          {p.deafened && <HeadphonesOffIcon />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Channel context menu (right-click a channel row) */}
      {channelMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setChannelMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setChannelMenu(null); }}
          />
          <div
            className="fixed bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl py-1 z-50 min-w-[160px]"
            style={{
              left: Math.min(channelMenu.x, (typeof window !== "undefined" ? window.innerWidth : 800) - 180),
              top: Math.min(channelMenu.y, (typeof window !== "undefined" ? window.innerHeight : 600) - 150),
            }}
          >
            <div className="px-3 py-1.5 text-xs text-[var(--muted)] border-b border-[var(--accent-2)]/20 truncate max-w-[200px]">
              {channelMenu.channel.type === "voice" ? "🔊 " : "# "}{channelMenu.channel.name}
            </div>
            {(!channelMenu.channel.type || channelMenu.channel.type === "text") && (
              <button
                onClick={() => { toggleMute(channelMenu.channel.id); setChannelMenu(null); }}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-2)]"
              >
                {isMuted(channelMenu.channel.id) ? "Unmute Channel" : "Mute Channel"}
              </button>
            )}
            {canManageChannels && (
              <>
                {channelMenu.channel.type === "voice" && (
                  <button
                    onClick={() => { const c = channelMenu.channel; setChannelMenu(null); void handleConfigureVoiceRoom(c); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-2)]"
                  >
                    Room Purpose &amp; Scene
                  </button>
                )}
                {(!channelMenu.channel.type || channelMenu.channel.type === "text") && (
                  <button
                    onClick={() => { const c = channelMenu.channel; setChannelMenu(null); void handleConfigureRetention(c); }}
                    className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-2)]"
                  >
                    Leave-no-trace Retention
                  </button>
                )}
                <button
                  onClick={() => { const c = channelMenu.channel; setChannelMenu(null); handleRenameChannel(c); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-2)]"
                >
                  Rename Channel
                </button>
                <button
                  onClick={() => { const c = channelMenu.channel; setChannelMenu(null); handleDeleteChannel(c); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-600/10"
                >
                  Delete Channel
                </button>
              </>
            )}
          </div>
        </>
      )}

      {inviteOpen && inviteState.code && (
        <InviteModal
          serverName={serverName}
          serverIcon={serverIcon}
          memberCount={memberCount ?? 0}
          serverId={serverId}
          inviteCode={inviteState.code}
          inviteExpiresAt={inviteState.expiresAt}
          inviteMaxUses={inviteState.maxUses}
          inviteUseCount={inviteState.useCount}
          inviteRevokedAt={inviteState.revokedAt}
          isOwner={currentUserRole === "owner"}
          onInviteUpdated={(invite) => {
            setInviteState({
              code: invite.inviteCode,
              expiresAt: invite.inviteExpiresAt,
              maxUses: invite.inviteMaxUses,
              useCount: invite.inviteUseCount,
              revokedAt: invite.inviteRevokedAt,
            });
            onInviteUpdated?.(invite);
          }}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </div>
  );
}
