"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import Image from "next/image";
import ServerList from "@/components/ServerList";
import ChannelList from "@/components/ChannelList";
import ChatPanel from "@/components/ChatPanel";
import MemberList from "@/components/MemberList";
import VoicePanel from "@/components/VoicePanel";
import VoiceRoom from "@/components/VoiceRoom";
import VoiceStatusBar from "@/components/VoiceStatusBar";
import SettingsModal from "@/components/SettingsModal";
import KeyboardShortcutsPanel from "@/components/KeyboardShortcutsPanel";
import { SettingsIcon } from "@/components/VoicePanel";
import SearchPanel from "@/components/SearchPanel";
import Avatar from "@/components/Avatar";
import AmbientSounds from "@/components/AmbientSounds";
import ShareLink from "@/components/ShareLink";
import ConnectionStatusBar from "@/components/ConnectionStatusBar";
import DMPanel from "@/components/DMPanel";
import UserProfileModal from "@/components/UserProfileModal";
import FriendPanel from "@/components/FriendPanel";
import OnboardingWizard from "@/components/OnboardingWizard";
import ServerSettingsModal from "@/components/ServerSettingsModal";
import CustomEmojiManager from "@/components/CustomEmojiManager";
import ModerationPanel from "@/components/ModerationPanel";
import { ScheduleMessageModal } from "@/components/ScheduleMessageModal";
import AutoModSettings from "@/components/AutoModSettings";
import AuditLogViewer from "@/components/AuditLogViewer";
import PurgeMessagesModal from "@/components/PurgeMessagesModal";
import ChannelPermissionsModal from "@/components/ChannelPermissionsModal";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";
import { displayName } from "@/lib/utils";
import { toastResponseError } from "@/lib/toast";

import { useAuth } from "@/hooks/useAuth";
import { useServers } from "@/hooks/useServers";
import { useChannels } from "@/hooks/useChannels";
import { usePresence } from "@/hooks/usePresence";
import { useVoice } from "@/hooks/useVoice";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";
import EmberInbox, { type InboxNotification } from "@/components/EmberInbox";
import GatheringsPanel from "@/components/GatheringsPanel";
import GuestUpgradeBanner from "@/components/GuestUpgradeBanner";
import { useDmUnread } from "@/hooks/useDmUnread";

import type { Channel, Server } from "@/types/chat";

type ChannelWithSlowMode = Channel & { slowModeSeconds?: number };
type ServerWithSettings = Server & {
  description?: string | null;
  isPublic?: boolean;
  welcomeMessage?: string | null;
};

const APP_VERSION = `v${process.env.NEXT_PUBLIC_APP_VERSION ?? "dev"}`;

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--muted)] gap-3">
        <Image src="/Campfire-Logo.png" alt="Campfire" width={64} height={64} className="w-16 h-16 animate-pulse" />
        <span>Following tracks into the woods...</span>
      </div>
    }>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const auth = useAuth();
  const srv = useServers();
  const ch = useChannels(srv.activeServer);
  const presence = usePresence(srv.activeServer, auth.user);
  const { voicePanelRef, ...voice } = useVoice(srv.activeServer);
  const activeChannelDetails = ch.activeChannel as ChannelWithSlowMode | null;
  const activeServerDetails = srv.activeServer as ServerWithSettings | null;

  const [socketStatus, setSocketStatus] = useState<"connected" | "connecting" | "disconnected">("connecting");
  const offlineQueue = useOfflineQueue();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const dmUnread = useDmUnread(auth.user?.id, dmOpen);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [blockReloadToken, setBlockReloadToken] = useState(0);
  const blockUserId = auth.user?.id;
  const blockRequestKey = `${blockUserId ?? "anonymous"}:${blockReloadToken}`;
  const [blockLoadResult, setBlockLoadResult] = useState<{
    key: string;
    ids: Set<string> | null;
    failed: boolean;
  } | null>(null);
  const currentBlockResult = blockLoadResult?.key === blockRequestKey
    ? blockLoadResult
    : null;
  const blockedUserIds = currentBlockResult?.ids ?? null;
  const blockLoadFailed = currentBlockResult?.failed ?? false;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Whether the main panel is showing the voice room. Decoupled from the voice
  // CONNECTION (voice.activeVoiceChannel) so you can browse text channels while
  // staying in the call. The connection persists; only the VIEW changes.
  const [viewingVoiceRoom, setViewingVoiceRoom] = useState(false);
  // Opening DMs/Friends takes the voice room off-screen — drop the room view so
  // the persistent VoiceStatusBar (mute/disconnect) shows instead of a hidden hot mic.
  const [statusDraft, setStatusDraft] = useState<{ userId: string; value: string } | null>(null);
  const statusMessage = statusDraft && statusDraft.userId === auth.user?.id
    ? statusDraft.value
    : auth.user?.statusMessage ?? "";
  const setStatusMessage = useCallback((value: string) => {
    const userId = auth.user?.id;
    if (userId) setStatusDraft({ userId, value });
  }, [auth.user?.id]);
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [emojiManagerOpen, setEmojiManagerOpen] = useState(false);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [autoModOpen, setAutoModOpen] = useState(false);
  const [auditLogOpen, setAuditLogOpen] = useState(false);
  const [purgeModalOpen, setPurgeModalOpen] = useState(false);
  const [channelPermsOpen, setChannelPermsOpen] = useState(false);

  const [dmTargetConversationId, setDmTargetConversationId] = useState<string | null>(null);

  const toggleDmPanel = useCallback(() => {
    const willOpen = !dmOpen;
    setDmOpen(willOpen);
    setFriendsOpen(false);
    setDmTargetConversationId(null);
    setSidebarOpen(false);
    if (willOpen) setViewingVoiceRoom(false);
  }, [dmOpen]);

  const toggleFriendsPanel = useCallback(() => {
    const willOpen = !friendsOpen;
    setFriendsOpen(willOpen);
    setDmOpen(false);
    setDmTargetConversationId(null);
    setSidebarOpen(false);
    if (willOpen) setViewingVoiceRoom(false);
  }, [friendsOpen]);

  const openDmPanel = useCallback(() => {
    setFriendsOpen(false);
    setDmOpen(true);
    setViewingVoiceRoom(false);
  }, []);

  // Friends / profile "Message" buttons: open (or create) the DM and land in that thread.
  const openDmWith = useCallback(async (userId: string) => {
    const res = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: userId }),
    });
    if (!res.ok) {
      await toastResponseError(res, "Couldn't open that conversation");
      return false;
    }
    const data = await res.json().catch(() => ({}));
    setDmTargetConversationId(typeof data.conversationId === "string" ? data.conversationId : null);
    openDmPanel();
    return true;
  }, [openDmPanel]);
  const [gatheringsOpen, setGatheringsOpen] = useState(false);
  // Message to scroll to + highlight once ChatPanel has it (search, saved, journal jumps).
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null);
  // Ids removed by a moderator purge — hidden locally right away.
  const [purgedIds, setPurgedIds] = useState<string[]>([]);

  async function saveStatusMessage(msg: string) {
    await fetch("/api/auth/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusMessage: msg }),
    });
  }

  useEffect(() => {
    if (!blockUserId) return;
    let cancelled = false;
    fetch("/api/blocks")
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load privacy controls");
        return response.json();
      })
      .then((data: { blocks?: Array<{ user: { id: string } }> }) => {
        if (!cancelled) {
          setBlockLoadResult({
            key: blockRequestKey,
            ids: new Set((data.blocks ?? []).map((entry) => entry.user.id)),
            failed: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBlockLoadResult({ key: blockRequestKey, ids: null, failed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [blockRequestKey, blockUserId]);

  const handleBlockChange = useCallback((userId: string, blocked: boolean) => {
    setBlockLoadResult((current) => {
      if (!current || current.key !== blockRequestKey || !current.ids) return current;
      const next = new Set(current.ids);
      if (blocked) next.add(userId);
      else next.delete(userId);
      return { ...current, ids: next };
    });
  }, [blockRequestKey]);

  useKeyboardShortcuts({
    activeVoiceChannel: voice.activeVoiceChannel,
    searchOpen,
    settingsOpen,
    shortcutsOpen,
    setSearchOpen,
    setSettingsOpen,
    setShortcutsOpen,
    toggleMute: voice.toggleMute,
    toggleDeafen: voice.toggleDeafen,
  });

  // Ember Inbox navigation: jump to the space a notification points at.
  const handleNotificationNavigate = useCallback((notification: InboxNotification) => {
    if (notification.type === "gathering" && notification.serverId) {
      const server = srv.servers.find((s) => s.id === notification.serverId);
      if (!server) return;
      setDmOpen(false);
      setFriendsOpen(false);
      setViewingVoiceRoom(false);
      srv.selectServer(server, ch.setActiveChannel);
      setGatheringsOpen(true);
      return;
    }
    if (notification.type === "friend_request") {
      setDmOpen(false);
      setFriendsOpen(true);
      setViewingVoiceRoom(false);
      return;
    }
    if (notification.type === "dm") {
      setDmTargetConversationId(notification.conversationId);
      openDmPanel();
      return;
    }
    if (notification.serverId) {
      const server = srv.servers.find((s) => s.id === notification.serverId);
      if (!server) return;
      setDmOpen(false);
      setFriendsOpen(false);
      setViewingVoiceRoom(false);
      srv.selectServer(server, ch.setActiveChannel);
      const channel = server.channels.find((c) => c.id === notification.channelId);
      if (channel) ch.setActiveChannel(channel);
    }
  }, [srv, ch, openDmPanel]);


  // Init: fetch user + servers, connect socket, restore URL selection
  useEffect(() => {
    async function init() {
      const user = await auth.fetchUser();
      if (!user) return;

      const serverList = await srv.fetchServers();
      const socket = connectSocket();

      // "connect" also fires after every reconnect; reconnect progress events live on the Manager.
      socket.on("connect", () => { setSocketStatus("connected"); offlineQueue.flush(); });
      socket.on("disconnect", () => setSocketStatus("disconnected"));
      socket.io.on("reconnect_attempt", () => setSocketStatus("connecting"));
      // A handshake refused by the server's auth middleware is not retried automatically.
      // Only log out when the HTTP session is really gone; otherwise (DB blip) try again.
      socket.on("connect_error", (err) => {
        if (socket.active) return;
        void fetch("/api/auth/me").then((res) => {
          if (res.status === 401 && err.message === "Unauthorized") void auth.logout();
          else setTimeout(() => { if (!socket.connected) socket.connect(); }, 3000);
        }).catch(() => setTimeout(() => { if (!socket.connected) socket.connect(); }, 3000));
      });

      // Restore from URL
      if (ch.urlServerId && serverList.length > 0) {
        const saved = serverList.find((s) => s.id === ch.urlServerId);
        const target = saved || serverList[0];
        srv.setActiveServer(target);
        const textChs = target.channels.filter((c) => !c.type || c.type === "text");
        const savedCh = ch.urlChannelId ? textChs.find((c) => c.id === ch.urlChannelId) : textChs[0];
        if (savedCh) ch.setActiveChannel(savedCh);
      } else if (serverList.length > 0) {
        srv.setActiveServer(serverList[0]);
        const textChs = serverList[0].channels.filter((c) => !c.type || c.type === "text");
        if (textChs.length > 0) ch.setActiveChannel(textChs[0]);
      }

      auth.setLoading(false);
    }

    init();
    return () => disconnectSocket();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const jumpToMessage = useCallback((channelId: string, messageId: string) => {
    const server = srv.servers.find((s) => s.channels.some((c) => c.id === channelId));
    const channel = server?.channels.find((c) => c.id === channelId);
    if (!server || !channel) return;
    if (server.id !== srv.activeServer?.id) srv.selectServer(server, ch.setActiveChannel);
    ch.setActiveChannel(channel);
    setDmOpen(false);
    setFriendsOpen(false);
    setViewingVoiceRoom(false);
    setSearchOpen(false);
    setFocusMessageId(messageId);
  }, [srv, ch]);

  // Server select handler
  const handleServerSelect = useCallback((server: typeof srv.activeServer & object) => {
    srv.selectServer(server, ch.setActiveChannel);
    presence.resetPresence();
    setDmTargetConversationId(null);
  }, [srv, ch, presence]);

  const handleServerCreated = useCallback((server: typeof srv.activeServer & object) => {
    srv.activateServer(server, ch.setActiveChannel);
  }, [srv, ch]);

  const handleServerJoined = useCallback((server: typeof srv.activeServer & object) => {
    srv.activateServer(server, ch.setActiveChannel);
  }, [srv, ch]);

  const handleChannelCreated = useCallback((channel: Channel) => {
    srv.addChannel(channel);
    if (!channel.type || channel.type === "text") {
      ch.setActiveChannel(channel);
    }
    if (srv.activeServer) {
      getSocket().emit("channel:created", { serverId: srv.activeServer.id, channelId: channel.id });
    }
  }, [srv, ch]);

  // Live channel lifecycle from other members — create/rename/reorder/delete
  // without a refresh. The realtime server re-reads each channel from the DB,
  // so payloads here are authoritative.
  useEffect(() => {
    const socket = getSocket();
    const activeServerId = srv.activeServer?.id;
    if (!activeServerId) return;

    function onChannelCreatedEvt(data: { serverId: string; channels: Channel[] }) {
      if (data.serverId !== activeServerId) return;
      data.channels.forEach((c) => srv.addChannel(c));
    }
    function onChannelsUpdatedEvt(data: { serverId: string; channels: Channel[] }) {
      if (data.serverId !== activeServerId) return;
      srv.updateChannels(data.channels);
      const updatedActive = data.channels.find((c) => c.id === ch.activeChannel?.id);
      if (updatedActive && ch.activeChannel) {
        ch.setActiveChannel({ ...ch.activeChannel, ...updatedActive });
      }
    }
    function onChannelDeletedEvt(data: { serverId: string; channelId: string }) {
      if (data.serverId !== activeServerId) return;
      if (voice.activeVoiceChannel?.id === data.channelId) { voice.disconnect(); setViewingVoiceRoom(false); }
      srv.removeChannel(data.channelId);
      if (ch.activeChannel?.id === data.channelId) {
        const remaining = srv.activeServer?.channels.filter(
          (c) => c.id !== data.channelId && (!c.type || c.type === "text")
        ) || [];
        ch.setActiveChannel(remaining[0] || null);
      }
    }

    socket.on("channel:created", onChannelCreatedEvt);
    socket.on("channels:updated", onChannelsUpdatedEvt);
    socket.on("channel:deleted", onChannelDeletedEvt);
    return () => {
      socket.off("channel:created", onChannelCreatedEvt);
      socket.off("channels:updated", onChannelsUpdatedEvt);
      socket.off("channel:deleted", onChannelDeletedEvt);
    };
  }, [srv, ch, voice]);

  if (auth.loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--muted)] gap-3">
        <Image src="/Campfire-Logo.png" alt="Campfire" width={64} height={64} className="w-16 h-16 animate-pulse" />
        <span>Following tracks into the woods...</span>
      </div>
    );
  }

  const voiceBarVisible = Boolean(voice.activeVoiceChannel && !viewingVoiceRoom && auth.user);
  const serverRail = (
    <ServerList
      servers={srv.servers}
      activeServerId={dmOpen ? undefined : srv.activeServer?.id}
      dmActive={dmOpen}
      friendsActive={friendsOpen}
      unreadServerIds={(() => {
        if (ch.unreadCounts.size === 0) return undefined;
        const unreadChannelIds = new Set(ch.unreadCounts.keys());
        const result = new Set<string>();
        for (const server of srv.servers) {
          if (server.channels.some((c) => unreadChannelIds.has(c.id))) {
            result.add(server.id);
          }
        }
        return result.size > 0 ? result : undefined;
      })()}
      onDmClick={toggleDmPanel}
      onFriendsClick={toggleFriendsPanel}
      onServerSelect={(s) => { setDmOpen(false); setFriendsOpen(false); handleServerSelect(s); }}
      onServerCreated={handleServerCreated}
      onServerJoined={handleServerJoined}
      currentUserId={auth.user?.id}
      dmUnreadCount={dmUnread.total}
      onServerUpdated={({ id, icon }) => {
        if (id === srv.activeServer?.id) srv.updateActiveServer({ icon });
        else srv.setServers((list) => list.map((s) => (s.id === id ? { ...s, icon } : s)));
      }}
    />
  );
  const mobileTabClass = (active: boolean) =>
    `flex flex-col items-center gap-0.5 min-h-[44px] min-w-[56px] justify-center transition-colors ${
      active ? "text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--text)]"
    }`;

  return (
    <div
      id="main-content"
      className={`h-dvh flex bg-[var(--bg)] relative md:pb-0 ${voiceBarVisible ? "pb-[116px]" : "pb-16"}`}
    >
      <ConnectionStatusBar status={socketStatus} queuedCount={offlineQueue.queuedCount} />
      {auth.user?.isGuest && (
        <GuestUpgradeBanner
          username={auth.user.username}
          guestExpiresAt={auth.user.guestExpiresAt}
          onUpgraded={(fields) => {
            auth.updateUser({ ...fields, isGuest: false, guestExpiresAt: null });
            // The socket still carries the guest JWT + name; re-handshake with the new cookie.
            const socket = getSocket();
            socket.disconnect();
            socket.connect();
          }}
        />
      )}

      {/* Server rail — desktop only; on mobile it lives inside the Channels drawer */}
      <div className="hidden md:flex">{serverRail}</div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Primary"
        className="md:hidden fixed bottom-0 left-0 right-0 h-16 flex items-center justify-around bg-[var(--panel)] border-t border-[var(--accent-2)]/30 z-20 pb-safe"
      >
        <button
          onClick={() => { setDmOpen(false); setFriendsOpen(false); setSidebarOpen((p) => !p); }}
          className={mobileTabClass(sidebarOpen || (!dmOpen && !friendsOpen))}
          aria-label="Servers and channels"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span className="text-[10px]">Camps</span>
        </button>
        <button
          onClick={toggleDmPanel}
          className={`relative ${mobileTabClass(dmOpen)}`}
          aria-label={dmUnread.total > 0 ? `Direct messages, ${dmUnread.total} unread` : "Direct messages"}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <span className="text-[10px]">DMs</span>
          {dmUnread.total > 0 && <span aria-hidden="true" className="absolute top-1.5 right-3 h-2 w-2 rounded-full bg-[var(--danger)]" />}
        </button>
        <button onClick={toggleFriendsPanel} className={mobileTabClass(friendsOpen)} aria-label="Friends">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" /><path d="M20 8v6M23 11h-6" />
          </svg>
          <span className="text-[10px]">Friends</span>
        </button>
        <button onClick={() => { setSidebarOpen(false); setSettingsOpen(true); }} className={mobileTabClass(settingsOpen)} aria-label="Settings">
          {auth.user ? (
            <Avatar username={auth.user.username} avatarUrl={auth.user.avatar} size={22} className="bg-[var(--accent-2)] text-[var(--text)]" />
          ) : (
            <SettingsIcon />
          )}
          <span className="text-[10px]">You</span>
        </button>
      </nav>

      {/* Mobile sidebar overlay backdrop */}
      {sidebarOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* DM panel */}
      {dmOpen && auth.user ? (
        <div className="flex-1 flex">
          <DMPanel
            currentUserId={auth.user.id}
            currentUsername={auth.user.username}
            currentAvatar={auth.user.avatar}
            key={dmTargetConversationId ?? "dm"}
            initialConversationId={dmTargetConversationId}
            onUnreadChange={dmUnread.setTotal}
            onClose={() => { setDmOpen(false); setDmTargetConversationId(null); }}
          />
        </div>
      ) : friendsOpen && auth.user ? (
        <FriendPanel
          currentUserId={auth.user.id}
          onlineMemberIds={presence.onlineMembers}
          onMessageUser={(userId) => { void openDmWith(userId); }}
        />
      ) : (
      <>
      {/* Channel sidebar — on mobile a drawer (server rail + channels), static column on desktop.
          Bottom padding leaves room for the user bar (and the voice bar while in a call). */}
      <div
        className={[
          "fixed left-0 top-0 bottom-0 z-40 flex bg-[var(--bg)] transform transition-transform duration-300",
          "md:static md:z-auto md:translate-x-0 md:transition-none",
          voiceBarVisible ? "pb-[140px]" : "pb-[88px]",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        {sidebarOpen && <div className="md:hidden flex">{serverRail}</div>}
        {srv.activeServer ? (
            <ChannelList
              key={srv.activeServer.id}
              serverName={srv.activeServer.name}
              serverBanner={(srv.activeServer as { banner?: string | null }).banner}
              channels={srv.activeServer.channels}
              activeChannelId={ch.activeChannel?.id}
              serverId={srv.activeServer.id}
              serverIcon={srv.activeServer.icon}
              inviteCode={srv.activeServer.inviteCode}
              inviteExpiresAt={srv.activeServer.inviteExpiresAt}
              inviteMaxUses={srv.activeServer.inviteMaxUses}
              inviteUseCount={srv.activeServer.inviteUseCount}
              inviteRevokedAt={srv.activeServer.inviteRevokedAt}
              memberCount={srv.activeServer._count.members}
              unreadCounts={ch.unreadCounts}
              currentUserId={auth.user?.id}
              currentUserRole={presence.userRole}
              canManageChannels={presence.canManageChannels}
              activeVoiceChannelId={voice.activeVoiceChannel?.id}
              viewingVoiceRoom={viewingVoiceRoom}
              voiceParticipants={voice.voiceParticipants}
              onChannelSelect={(channel) => {
                ch.selectChannel(channel);
                setViewingVoiceRoom(false); // browsing text — keep the call alive, just change the view
                setSidebarOpen(false);
              }}
              onChannelCreated={handleChannelCreated}
              onChannelsUpdated={(updated) => {
                srv.updateChannels(updated);
                if (srv.activeServer) {
                  getSocket().emit("channels:updated", { serverId: srv.activeServer.id, channelIds: updated.map((c) => c.id) });
                }
              }}
              onInviteUpdated={(invite) => srv.updateActiveServer(invite)}
              onChannelDeleted={(channelId) => {
                if (voice.activeVoiceChannel?.id === channelId) { voice.disconnect(); setViewingVoiceRoom(false); }
                srv.removeChannel(channelId);
                if (ch.activeChannel?.id === channelId) {
                  const remaining = srv.activeServer?.channels.filter(
                    (c) => c.id !== channelId && (!c.type || c.type === "text")
                  ) || [];
                  ch.setActiveChannel(remaining[0] || null);
                }
                if (srv.activeServer) {
                  getSocket().emit("channel:deleted", { serverId: srv.activeServer.id, channelId });
                }
              }}
              onVoiceJoin={(channel) => { voice.joinVoice(channel); setViewingVoiceRoom(true); }}
              onVoiceView={() => setViewingVoiceRoom(true)}
              selfSpeaking={voice.voiceState.participants.some((p) => p.userId === auth.user?.id && p.speaking)}
              onOpenServerSettings={() => setServerSettingsOpen(true)}
            />
        ) : (
          <div className="flex w-60 bg-[var(--panel)] flex-col items-center justify-center text-[var(--muted)] text-sm border-r border-[var(--accent-2)]/30 px-4 text-center gap-3 shrink-0">
            <p className="text-base text-[var(--text)]">No camps yet</p>
            <p className="text-xs">
              Use the <span className="text-[var(--accent)] font-bold">+</span> button to start a camp
              or the <span className="text-[var(--accent)] font-bold">&#8618;</span> button to join one with an invite
            </p>
          </div>
        )}
      </div>

      {/* Main panel — shows the voice room only when you're VIEWING it; the
          call keeps running in the background (VoicePanel) while you browse text. */}
      {viewingVoiceRoom && voice.activeVoiceChannel && auth.user ? (
        <VoiceRoom
          key={voice.activeVoiceChannel.id}
          channelId={voice.activeVoiceChannel.id}
          channelName={voice.activeVoiceChannel.name}
          roomMode={voice.activeVoiceChannel.roomMode}
          roomScene={voice.activeVoiceChannel.roomScene}
          participants={voice.voiceState.participants}
          currentUserId={auth.user.id}
          currentUserRole={presence.userRole}
          canManageChannels={presence.canManageChannels}
          muted={voice.voiceState.muted}
          deafened={voice.voiceState.deafened}
          pttMode={voice.pttMode}
          onToggleMute={voice.toggleMute}
          onToggleDeafen={voice.toggleDeafen}
          onTogglePTT={voice.togglePTT}
          onDisconnect={voice.disconnect}
          onUserVolumeChange={voice.setUserVolume}
          onServerMute={voice.serverMuteUser}
          onServerDeafen={voice.serverDeafenUser}
          onKickFromVoice={voice.kickFromVoice}
          onMoveUser={voice.moveUser}
          voiceChannels={srv.activeServer?.channels.filter((c) => c.type === "voice")}
          serverId={srv.activeServer?.id}
          onPlaySound={voice.playSound}
          reconnecting={voice.voiceState.reconnecting}
          sharing={voice.voiceState.sharing}
          cameraOn={voice.voiceState.cameraOn}
          onStartScreenShare={voice.startScreenShare}
          onStopScreenShare={voice.stopScreenShare}
          onToggleCamera={voice.toggleCamera}
          incomingScreenShares={voice.incomingScreenShares}
          remoteVideoStreams={voice.remoteVideoStreams}
          localCameraStream={voice.localCameraStream}
          localScreenStream={voice.localScreenStream}
        />
      ) : ch.activeChannel && auth.user && blockedUserIds === null ? (
        <div className="flex-1 flex items-center justify-center bg-[var(--panel-2)] text-[var(--muted)] px-6">
          <div className="max-w-sm text-center">
            <p className="text-sm font-semibold text-[var(--text)]">
              {blockLoadFailed ? "Privacy controls could not be loaded" : "Loading privacy controls..."}
            </p>
            <p className="mt-1 text-xs">
              {blockLoadFailed ? "Messages stay hidden until Campfire can confirm your block list." : "Checking who you have chosen to ignore before showing messages."}
            </p>
            {blockLoadFailed && <button className="mt-3 rounded bg-[var(--accent-2)] px-3 py-1.5 text-xs text-white" onClick={() => setBlockReloadToken((value) => value + 1)}>Retry</button>}
          </div>
        </div>
      ) : ch.activeChannel && auth.user && blockedUserIds ? (
        <ChatPanel
          channelId={ch.activeChannel.id}
          channelName={ch.activeChannel.name}
          channelTopic={ch.activeChannel.topic}
          channelSlowMode={activeChannelDetails?.slowModeSeconds ?? 0}
          currentUserId={auth.user.id}
          currentUsername={auth.user.username}
          currentAvatar={auth.user.avatar}
          canPin={presence.userRole === "owner" || presence.userRole === "admin" || presence.userRole === "mod"}
          canEditTopic={presence.userRole === "owner" || presence.userRole === "admin" || presence.userRole === "mod"}
          serverId={srv.activeServer?.id}
          blockedUserIds={blockedUserIds}
          focusMessageId={focusMessageId}
          onFocusHandled={() => setFocusMessageId(null)}
          purgedMessageIds={purgedIds}
          onJumpToMessage={jumpToMessage}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[var(--panel-2)] text-[var(--muted)]">
          <div className="text-center max-w-sm">
            <Image src="/Campfire-Logo.png" alt="Campfire" width={80} height={80} className="w-20 h-20 mx-auto mb-4 opacity-80" />
            <p className="text-2xl mb-2 text-[var(--text)]">Welcome to Campfire</p>
            {srv.servers.length === 0 ? (
              <p className="text-sm">
                Hit the <span className="text-[var(--accent)] font-bold">+</span> in the left rail to create your first server,
                or <span className="text-[var(--accent)] font-bold">&#8618;</span> to join one with an invite code.
              </p>
            ) : (
              <p className="text-sm">Select a channel to start chatting</p>
            )}
          </div>
        </div>
      )}

      {/* Right sidebar: members or search — hidden on mobile */}
      {srv.activeServer && !searchOpen && (
        <div className="hidden md:flex">
          <MemberList
            serverId={srv.activeServer.id}
            onlineMemberIds={presence.onlineMembers}
            memberStatuses={presence.memberStatuses}
            currentUserId={auth.user?.id}
            currentUserRole={presence.userRole}
            onViewProfile={setProfileUserId}
            onServerJoined={handleServerJoined}
          />
        </div>
      )}
      {searchOpen && srv.activeServer && blockedUserIds && (
        <SearchPanel
          serverId={srv.activeServer.id}
          blockedUserIds={blockedUserIds}
          onClose={() => setSearchOpen(false)}
          onJumpToMessage={jumpToMessage}
        />
      )}
      </>
      )}

      {/* Persistent "Voice Connected" bar — visible whenever you're in a call but
          browsing a text channel. The call (VoicePanel) keeps running; this is how
          you mute/deafen/hang up or jump back in. Mobile-visible (the user bar isn't). */}
      {voice.activeVoiceChannel && !viewingVoiceRoom && auth.user && (
        <div className="fixed inset-x-0 bottom-16 z-30 md:absolute md:inset-x-auto md:left-[72px] md:bottom-[88px] md:w-60">
          <VoiceStatusBar
            channelName={voice.activeVoiceChannel.name}
            muted={voice.voiceState.muted}
            deafened={voice.voiceState.deafened}
            reconnecting={voice.voiceState.reconnecting}
            onReturn={() => setViewingVoiceRoom(true)}
            onToggleMute={voice.toggleMute}
            onToggleDeafen={voice.toggleDeafen}
            serverMuted={voice.voiceState.serverMuted || voice.voiceState.serverDeafened}
            onDisconnect={() => { voice.disconnect(); setViewingVoiceRoom(false); }}
          />
        </div>
      )}

      {/* Headless voice engine */}
      {voice.activeVoiceChannel && auth.user && (
        <VoicePanel
          key={voice.activeVoiceChannel.id}
          ref={voicePanelRef}
          channelId={voice.activeVoiceChannel.id}
          channelName={voice.activeVoiceChannel.name}
          serverId={srv.activeServer?.id || ""}
          currentUserId={auth.user.id}
          currentUsername={auth.user.username}
          currentUserAvatar={auth.user.avatar}
          onParticipantsChange={voice.handleParticipantsChange}
          onDisconnect={() => { voice.leaveVoice(); setViewingVoiceRoom(false); }}
          onStateChange={voice.setVoiceState}
          onScreenShareChange={voice.handleScreenShareChange}
          onVideoStreamsChange={voice.handleVideoStreamsChange}
          pttMode={voice.pttMode}
        />
      )}

      {/* User bar — bottom of the channel column on desktop; inside the Channels drawer on mobile */}
      <div
        className={`${sidebarOpen ? "flex" : "hidden"} md:flex fixed md:absolute bottom-0 left-[72px] w-60 h-[88px] flex-col bg-[var(--panel-2)] border-t border-r border-[var(--accent-2)]/30 z-50 md:z-10`}
      >
        <div className="flex items-center gap-2 px-2.5 h-12 min-w-0">
          {auth.user && (
            <div
              className="relative cursor-pointer flex items-center gap-2 min-w-0 flex-1 rounded-md px-1 py-1 hover:bg-[var(--accent-2)]/15 transition-colors"
              onClick={() => setStatusMenuOpen((p) => !p)}
              title="Set status"
            >
              <div className="relative shrink-0">
                <Avatar
                  username={auth.user.username}
                  avatarUrl={auth.user.avatar}
                  size={32}
                  className="bg-[var(--accent-2)] text-[var(--text)]"
                />
                <div
                  className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--panel-2)] ${
                    presence.myStatus === "online" ? "bg-green-500" :
                    presence.myStatus === "idle" ? "bg-yellow-500" :
                    presence.myStatus === "dnd" ? "bg-red-500" :
                    "bg-gray-500"
                  }`}
                />
              </div>
              <div className="min-w-0 leading-tight">
                <div className="text-sm font-semibold text-[var(--text)] truncate">{displayName(auth.user.username)}</div>
                <div className="text-[11px] text-[var(--muted)] truncate">
                  {statusMessage || ({ online: "Online", idle: "Idle", dnd: "Do Not Disturb", invisible: "Invisible" } as Record<string, string>)[presence.myStatus] || "Online"}
                </div>
              </div>
              {statusMenuOpen && (
                <div className="absolute bottom-full left-0 mb-2 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl py-1 w-52 z-50" onClick={(e) => e.stopPropagation()}>
                  {([
                    ["online", "Online", "bg-green-500"],
                    ["idle", "Idle", "bg-yellow-500"],
                    ["dnd", "Do Not Disturb", "bg-red-500"],
                    ["invisible", "Invisible", "bg-gray-500"],
                  ] as const).map(([status, label, color]) => (
                    <button
                      key={status}
                      onClick={(e) => { e.stopPropagation(); presence.changeStatus(status); setStatusMenuOpen(false); }}
                      className={`w-full px-3 py-1.5 text-left text-sm flex items-center gap-2 hover:bg-[var(--accent-2)]/20 ${
                        presence.myStatus === status ? "text-[var(--text)]" : "text-[var(--muted)]"
                      }`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
                      {label}
                    </button>
                  ))}
                  <hr className="border-[var(--accent-2)]/20 my-1" />
                  <div className="px-2 pb-2 space-y-1.5">
                    <input
                      type="text"
                      value={statusMessage}
                      maxLength={128}
                      placeholder="What are you up to?"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setStatusMessage(e.target.value)}
                      onBlur={() => saveStatusMessage(statusMessage)}
                      className="w-full text-xs px-2 py-1.5 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/40 rounded focus:outline-none focus:border-[var(--accent)] placeholder:text-[var(--muted)]"
                    />
                    <div className="flex flex-wrap gap-1">
                      {(["🎮 Gaming", "☕ AFK", "💼 Busy", "🎵 Music", "🔕 DND"] as const).map((preset) => (
                        <button
                          key={preset}
                          onClick={(e) => { e.stopPropagation(); setStatusMessage(preset); saveStatusMessage(preset); }}
                          className="text-[10px] px-1.5 py-0.5 bg-[var(--panel-2)] text-[var(--muted)] rounded hover:bg-[var(--accent-2)]/30 hover:text-[var(--text)] transition-colors"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); setStatusMessage(""); saveStatusMessage(""); }}
                        className="flex-1 text-[10px] px-2 py-1 bg-[var(--panel-2)] text-[var(--muted)] rounded hover:text-[var(--text)] transition-colors"
                      >
                        Clear
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); saveStatusMessage(statusMessage); setStatusMenuOpen(false); }}
                        className="flex-1 text-[10px] px-2 py-1 bg-[var(--accent-2)]/30 text-[var(--text)] rounded hover:bg-[var(--accent-2)]/50 transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => setSettingsOpen(true)}
            className="shrink-0 p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--accent-2)]/15 transition-colors"
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
        </div>
        <div className="flex items-center justify-between px-3 h-10 border-t border-[var(--accent-2)]/20 [&>*]:shrink-0">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            title="Search (Ctrl+K)"
            aria-label="Search (Ctrl+K)"
          >
            <svg width="15" height="15" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <ShareLink />
          <EmberInbox
            currentServerId={dmOpen || friendsOpen ? null : srv.activeServer?.id}
            currentChannelId={dmOpen || friendsOpen ? null : ch.activeChannel?.id}
            onNavigate={handleNotificationNavigate}
          />
          <AmbientSounds />
          {srv.activeServer && (
            <button
              onClick={() => setGatheringsOpen(true)}
              className="text-[var(--muted)] transition-colors hover:text-amber-300"
              title="Camp Gatherings"
              aria-label="Open Camp Gatherings"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 10h18" />
                <path d="M12 13c1.5 1.2 2 2.2 2 3a2 2 0 0 1-4 0c0-.8.5-1.8 2-3Z" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setShortcutsOpen((p) => !p)}
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors font-bold text-sm"
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            ?
          </button>
          {ch.activeChannel && (
            <button
              onClick={() => setScheduleModalOpen(true)}
              className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              title="Schedule Message"
              aria-label="Schedule a message"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
          )}
          <button
            onClick={auth.logout}
            className="text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
            title="Log out"
            aria-label="Log out"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>


      {/* Onboarding wizard */}
      {srv.servers.length === 0 && !auth.loading && !onboardingDone && auth.user && (
        <OnboardingWizard
          userId={auth.user.id}
          username={auth.user.username}
          currentAvatar={auth.user.avatar}
          onComplete={async () => {
            setOnboardingDone(true);
            const serverList = await srv.fetchServers();
            if (serverList.length > 0) {
              srv.setActiveServer(serverList[0]);
              const textChs = serverList[0].channels.filter((c) => !c.type || c.type === "text");
              if (textChs.length > 0) ch.setActiveChannel(textChs[0]);
            }
          }}
          onAvatarChange={auth.updateAvatar}
        />
      )}

      {srv.activeServer && (
        <GatheringsPanel
          open={gatheringsOpen}
          serverId={srv.activeServer.id}
          channels={srv.activeServer.channels}
          onClose={() => setGatheringsOpen(false)}
          onJoinChannel={(channelId) => {
            const channel = srv.activeServer?.channels.find(
              (candidate) => candidate.id === channelId,
            );
            if (!channel) return;
            if (channel.type === "voice") {
              voice.joinVoice(channel);
              setViewingVoiceRoom(true);
            } else {
              ch.selectChannel(channel);
              setViewingVoiceRoom(false);
            }
            setSidebarOpen(false);
          }}
        />
      )}

      {/* User profile modal */}
      {profileUserId && auth.user && (
        <UserProfileModal
          key={profileUserId}
          userId={profileUserId}
          currentUserId={auth.user.id}
          onClose={() => setProfileUserId(null)}
          onMessageUser={async (uid) => {
            if (await openDmWith(uid)) setProfileUserId(null);
          }}
          onBlockChange={handleBlockChange}
        />
      )}

      {/* Settings modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        username={auth.user?.username}
        currentAvatar={auth.user?.avatar}
        onAvatarChange={auth.updateAvatar}
        onInputSensitivityChange={voice.setInputSensitivity}
        onBlockChange={handleBlockChange}
        onLogout={() => { setSettingsOpen(false); void auth.logout(); }}
        onUsernameChange={(username) => auth.updateUser({ username })}
      />

      {/* Keyboard shortcuts panel */}
      <KeyboardShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Server settings modal — owner only */}
      {activeServerDetails && (
        <ServerSettingsModal
          open={serverSettingsOpen}
          serverId={activeServerDetails.id}
          serverName={activeServerDetails.name}
          serverDescription={activeServerDetails.description}
          serverIcon={activeServerDetails.icon}
          serverBanner={activeServerDetails.banner}
          isPublic={activeServerDetails.isPublic}
          welcomeMessage={activeServerDetails.welcomeMessage}
          onClose={() => setServerSettingsOpen(false)}
          onUpdated={(updates) => srv.updateActiveServer(updates as Partial<Server>)}
          onDeleted={() => {
            const deletedId = activeServerDetails.id;
            setServerSettingsOpen(false);
            if (voice.activeVoiceChannel && activeServerDetails.channels.some((c) => c.id === voice.activeVoiceChannel?.id)) {
              voice.disconnect();
              setViewingVoiceRoom(false);
            }
            srv.removeActiveServer();
            const next = srv.servers.find((s) => s.id !== deletedId);
            if (next) handleServerSelect(next);
            else ch.setActiveChannel(null);
          }}
          hasActiveChannel={!!ch.activeChannel}
          onOpenModeration={() => { setServerSettingsOpen(false); setModerationOpen(true); }}
          onOpenEmoji={() => { setServerSettingsOpen(false); setEmojiManagerOpen(true); }}
          onOpenAutoMod={() => { setServerSettingsOpen(false); setAutoModOpen(true); }}
          onOpenAudit={() => { setServerSettingsOpen(false); setAuditLogOpen(true); }}
          onOpenPurge={() => { setServerSettingsOpen(false); setPurgeModalOpen(true); }}
          onOpenChannelPerms={() => { setServerSettingsOpen(false); setChannelPermsOpen(true); }}
        />
      )}

      {/* Custom emoji manager */}
      {srv.activeServer && (
        <CustomEmojiManager
          serverId={srv.activeServer.id}
          open={emojiManagerOpen}
          onClose={() => setEmojiManagerOpen(false)}
        />
      )}

      {/* Moderation panel */}
      {srv.activeServer && auth.user && (
        <ModerationPanel
          serverId={srv.activeServer.id}
          currentUserId={auth.user.id}
          currentUserRole={presence.userRole}
          open={moderationOpen}
          onClose={() => setModerationOpen(false)}
          onJumpToMessage={jumpToMessage}
        />
      )}

      {/* Schedule message modal */}
      {scheduleModalOpen && ch.activeChannel && (
        <ScheduleMessageModal
          channelId={ch.activeChannel.id}
          onClose={() => setScheduleModalOpen(false)}
        />
      )}

      {/* Auto-moderation settings */}
      {srv.activeServer && (
        <AutoModSettings
          serverId={srv.activeServer.id}
          open={autoModOpen}
          onClose={() => setAutoModOpen(false)}
        />
      )}

      {/* Audit log viewer */}
      {srv.activeServer && (
        <AuditLogViewer
          serverId={srv.activeServer.id}
          open={auditLogOpen}
          onClose={() => setAuditLogOpen(false)}
        />
      )}

      {/* Purge messages modal */}
      {purgeModalOpen && ch.activeChannel && (
        <PurgeMessagesModal
          channelId={ch.activeChannel.id}
          channelName={ch.activeChannel.name}
          open={purgeModalOpen}
          onClose={() => setPurgeModalOpen(false)}
          onPurged={(ids) => {
            const channelId = ch.activeChannel?.id;
            // Server re-checks the rows are gone before relaying the batch to the channel.
            if (channelId) getSocket().emit("messages:purge", { channelId, messageIds: ids });
            setPurgedIds((prev) => [...prev, ...ids]);
          }}
        />
      )}

      {/* Channel permissions modal */}
      {channelPermsOpen && ch.activeChannel && (
        <ChannelPermissionsModal
          channelId={ch.activeChannel.id}
          channelName={ch.activeChannel.name}
          open={channelPermsOpen}
          onClose={() => setChannelPermsOpen(false)}
        />
      )}

      {/* Version */}
      <div className="absolute bottom-3 right-3 text-xs text-[var(--muted)]">
        {APP_VERSION}
      </div>
    </div>
  );
}
