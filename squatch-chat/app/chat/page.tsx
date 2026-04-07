"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import ServerList from "@/components/ServerList";
import ChannelList from "@/components/ChannelList";
import ChatPanel from "@/components/ChatPanel";
import MemberList from "@/components/MemberList";
import VoicePanel from "@/components/VoicePanel";
import VoiceRoom from "@/components/VoiceRoom";
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
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { displayName } from "@/lib/utils";

import { useAuth } from "@/hooks/useAuth";
import { useServers } from "@/hooks/useServers";
import { useChannels } from "@/hooks/useChannels";
import { usePresence } from "@/hooks/usePresence";
import { useVoice } from "@/hooks/useVoice";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useOfflineQueue } from "@/hooks/useOfflineQueue";
import { useNotifications } from "@/hooks/useNotifications";
import NotificationBell from "@/components/NotificationBell";

import type { Channel } from "@/types/chat";

const APP_VERSION = "v0.0.7";

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--muted)] gap-3">
        <img src="/Campfire-Logo.png" alt="Campfire" className="w-16 h-16 animate-pulse" />
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
  const voice = useVoice(srv.activeServer);

  const { notify } = useNotifications();
  const [notifications, setNotifications] = useState<Array<{id: string, title: string, body: string, timestamp: number, read: boolean}>>([]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileView, setMobileView] = useState<"channels" | "chat" | "members">("channels");
  const [statusMessage, setStatusMessage] = useState("");

  async function saveStatusMessage(msg: string) {
    await fetch("/api/auth/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusMessage: msg }),
    });
  }

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

  // Notification socket listeners
  useEffect(() => {
    const { getSocket } = require("@/lib/socket");
    const s = getSocket();

    function pushNotification(title: string, body: string) {
      setNotifications((prev) => {
        const item = { id: Date.now().toString() + Math.random(), title, body, timestamp: Date.now(), read: false };
        return [item, ...prev].slice(0, 10);
      });
    }

    function onDmMessage(message: { content: string }) {
      notify("New DM", message.content);
      pushNotification("New DM", message.content);
    }

    function onFriendRequest() {
      notify("Friend Request", "Someone sent you a friend request");
      pushNotification("Friend Request", "Someone sent you a friend request");
    }

    s.on("dm:message", onDmMessage);
    s.on("friend:request", onFriendRequest);

    return () => {
      s.off("dm:message", onDmMessage);
      s.off("friend:request", onFriendRequest);
    };
  }, [notify]);

  const handleMarkAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  // Sync statusMessage from user once loaded
  useEffect(() => {
    if (auth.user?.statusMessage !== undefined) {
      setStatusMessage(auth.user.statusMessage || "");
    }
  }, [auth.user?.statusMessage]);

  // Init: fetch user + servers, connect socket, restore URL selection
  useEffect(() => {
    async function init() {
      const user = await auth.fetchUser();
      if (!user) return;

      const serverList = await srv.fetchServers();
      const socket = connectSocket();

      socket.on("connect", () => { setSocketStatus("connected"); offlineQueue.flush(); });
      socket.on("disconnect", () => setSocketStatus("disconnected"));
      socket.on("reconnecting", () => setSocketStatus("connecting"));
      socket.on("reconnect", () => { setSocketStatus("connected"); offlineQueue.flush(); });

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

  // Server select handler
  const handleServerSelect = useCallback((server: typeof srv.activeServer & object) => {
    srv.selectServer(server, ch.setActiveChannel);
    presence.resetPresence();
    ch.resetUnreads();
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
  }, [srv, ch]);

  const handleServerRenamed = useCallback((newName: string) => {
    srv.renameActiveServer(newName);
  }, [srv]);

  const handleServerDeleted = useCallback(() => {
    srv.removeActiveServer();
    ch.setActiveChannel(null);
  }, [srv, ch]);

  if (auth.loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--muted)] gap-3">
        <img src="/Campfire-Logo.png" alt="Campfire" className="w-16 h-16 animate-pulse" />
        <span>Following tracks into the woods...</span>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-[var(--bg)] relative">
      <ConnectionStatusBar status={socketStatus} queuedCount={offlineQueue.queuedCount} />

      {/* Server rail — desktop only; mobile uses bottom tab bar */}
      <div className="hidden md:flex">
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
          onDmClick={() => { setDmOpen((p) => !p); setFriendsOpen(false); }}
          onFriendsClick={() => { setFriendsOpen((p) => !p); setDmOpen(false); }}
          onServerSelect={(s) => { setDmOpen(false); setFriendsOpen(false); handleServerSelect(s); }}
          onServerCreated={handleServerCreated}
          onServerJoined={handleServerJoined}
        />
      </div>

      {/* Mobile bottom tab bar — replaces server rail on small screens */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 flex items-center justify-around bg-[var(--bg)] border-t border-[var(--accent-2)]/30 z-20 pb-safe">
        <button
          onClick={() => setSidebarOpen((p) => !p)}
          className="flex flex-col items-center gap-0.5 min-h-[44px] min-w-[44px] justify-center text-[var(--muted)] hover:text-[var(--text)] transition-colors"
          title="Channels"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          <span className="text-[10px]">Channels</span>
        </button>
        {srv.servers.slice(0, 3).map((server) => (
          <button
            key={server.id}
            onClick={() => {
              setDmOpen(false);
              setFriendsOpen(false);
              handleServerSelect(server);
              setSidebarOpen(false);
              setMobileView("chat");
            }}
            className={`flex flex-col items-center gap-0.5 min-h-[44px] min-w-[44px] justify-center transition-colors ${
              srv.activeServer?.id === server.id && !dmOpen && !friendsOpen
                ? "text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            }`}
            title={server.name}
          >
            {(server as { icon?: string | null }).icon ? (
              <img
                src={(server as { icon?: string | null }).icon!}
                alt={server.name}
                className="w-7 h-7 rounded-full object-cover"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-[var(--accent-2)] flex items-center justify-center text-xs font-bold text-[var(--text)]">
                {server.name.charAt(0).toUpperCase()}
              </div>
            )}
          </button>
        ))}
        <button
          onClick={() => { setDmOpen((p) => !p); setFriendsOpen(false); }}
          className={`flex flex-col items-center gap-0.5 min-h-[44px] min-w-[44px] justify-center transition-colors ${
            dmOpen ? "text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
          }`}
          title="Direct Messages"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
          <span className="text-[10px]">DMs</span>
        </button>
      </div>

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
            onClose={() => setDmOpen(false)}
          />
        </div>
      ) : friendsOpen && auth.user ? (
        <FriendPanel
          currentUserId={auth.user.id}
          onlineMemberIds={presence.onlineMembers}
          onMessageUser={async (userId) => {
            const res = await fetch("/api/dm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ targetUserId: userId }),
            });
            if (res.ok) {
              setFriendsOpen(false);
              setDmOpen(true);
            }
          }}
        />
      ) : (
      <>
      {/* Channel sidebar — fixed overlay on mobile, static on desktop */}
      {srv.activeServer ? (
        <div
          className={[
            "fixed left-0 top-0 bottom-0 z-40 w-64 transform transition-transform duration-300",
            "md:static md:w-auto md:z-auto md:translate-x-0 md:transition-none",
            sidebarOpen ? "translate-x-0" : "-translate-x-full",
          ].join(" ")}
        >
          <ChannelList
            serverName={srv.activeServer.name}
            serverBanner={(srv.activeServer as { banner?: string | null }).banner}
            channels={srv.activeServer.channels}
            activeChannelId={ch.activeChannel?.id}
            serverId={srv.activeServer.id}
            unreadCounts={ch.unreadCounts}
            currentUserId={auth.user?.id}
            currentUserRole={presence.userRole}
            activeVoiceChannelId={voice.activeVoiceChannel?.id}
            voiceParticipants={voice.voiceParticipants}
            onChannelSelect={(channel) => {
              ch.selectChannel(channel);
              setSidebarOpen(false);
              setMobileView("chat");
            }}
            onChannelCreated={handleChannelCreated}
            onVoiceJoin={voice.joinVoice}
            onVoiceLeave={voice.leaveVoice}
            onServerRenamed={handleServerRenamed}
            onServerDeleted={handleServerDeleted}
          />
        </div>
      ) : (
        <div className="hidden md:flex w-60 bg-[var(--panel)] flex-col items-center justify-center text-[var(--muted)] text-sm border-r border-[var(--accent-2)]/30 px-4 text-center gap-3 shrink-0">
          <p className="text-base text-[var(--text)]">No servers yet</p>
          <p className="text-xs">
            Use the <span className="text-[var(--accent)] font-bold">+</span> button to create a server
            or the <span className="text-[var(--accent)] font-bold">&#8618;</span> button to join one
          </p>
        </div>
      )}

      {/* Main panel */}
      {voice.activeVoiceChannel && auth.user ? (
        <VoiceRoom
          channelId={voice.activeVoiceChannel.id}
          channelName={voice.activeVoiceChannel.name}
          participants={voice.voiceState.participants}
          currentUserId={auth.user.id}
          currentUserRole={presence.userRole}
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
      ) : ch.activeChannel && auth.user ? (
        <ChatPanel
          channelId={ch.activeChannel.id}
          channelName={ch.activeChannel.name}
          channelTopic={ch.activeChannel.topic}
          channelSlowMode={(ch.activeChannel as any)?.slowModeSeconds ?? 0}
          currentUserId={auth.user.id}
          currentUsername={auth.user.username}
          currentAvatar={auth.user.avatar}
          canPin={presence.userRole === "owner" || presence.userRole === "admin" || presence.userRole === "mod"}
          canEditTopic={presence.userRole === "owner" || presence.userRole === "admin" || presence.userRole === "mod"}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[var(--panel-2)] text-[var(--muted)]">
          <div className="text-center max-w-sm">
            <img src="/Campfire-Logo.png" alt="Campfire" className="w-20 h-20 mx-auto mb-4 opacity-80" />
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
          />
        </div>
      )}
      {searchOpen && srv.activeServer && (
        <SearchPanel
          serverId={srv.activeServer.id}
          onClose={() => setSearchOpen(false)}
          onJumpToMessage={(channelId) => {
            const found = srv.activeServer!.channels.find((c) => c.id === channelId);
            if (found) ch.setActiveChannel(found);
            setSearchOpen(false);
          }}
        />
      )}
      </>
      )}

      {/* Headless voice engine */}
      {voice.activeVoiceChannel && auth.user && (
        <VoicePanel
          ref={voice.voicePanelRef}
          channelId={voice.activeVoiceChannel.id}
          channelName={voice.activeVoiceChannel.name}
          serverId={srv.activeServer?.id || ""}
          currentUserId={auth.user.id}
          currentUsername={auth.user.username}
          currentUserAvatar={auth.user.avatar}
          onParticipantsChange={voice.handleParticipantsChange}
          onDisconnect={voice.leaveVoice}
          onStateChange={voice.setVoiceState}
          onScreenShareChange={voice.handleScreenShareChange}
          onVideoStreamsChange={voice.handleVideoStreamsChange}
        />
      )}

      {/* User bar — desktop only (hidden on mobile) */}
      <div className="hidden md:flex absolute bottom-0 left-[72px] w-60 h-12 bg-[var(--bg)] border-t border-r border-[var(--accent-2)]/30 items-center px-3 justify-between z-10">
        <div className="flex items-center gap-2 min-w-0">
          {auth.user && (
            <div className="relative cursor-pointer" onClick={() => setStatusMenuOpen((p) => !p)}>
              <Avatar
                username={auth.user.username}
                avatarUrl={auth.user.avatar}
                size={28}
                className="bg-[var(--accent-2)] text-[var(--text)]"
              />
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[var(--bg)] ${
                  presence.myStatus === "online" ? "bg-green-500" :
                  presence.myStatus === "idle" ? "bg-yellow-500" :
                  presence.myStatus === "dnd" ? "bg-red-500" :
                  "bg-gray-500"
                }`}
              />
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
          <span className="text-sm text-[var(--text)] truncate">
            {auth.user ? displayName(auth.user.username) : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            title="Search (Ctrl+K)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <ShareLink />
          <NotificationBell notifications={notifications} onMarkAllRead={handleMarkAllRead} />
          <AmbientSounds />
          <button
            onClick={() => setShortcutsOpen((p) => !p)}
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors font-bold text-sm"
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            title="Settings"
          >
            <SettingsIcon />
          </button>
          <button
            onClick={auth.logout}
            className="text-xs text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
          >
            Logout
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

      {/* User profile modal */}
      {profileUserId && auth.user && (
        <UserProfileModal
          userId={profileUserId}
          currentUserId={auth.user.id}
          onClose={() => setProfileUserId(null)}
          onMessageUser={async (uid) => {
            const res = await fetch("/api/dm", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ targetUserId: uid }),
            });
            if (res.ok) {
              setProfileUserId(null);
              setDmOpen(true);
            }
          }}
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
      />

      {/* Keyboard shortcuts panel */}
      <KeyboardShortcutsPanel open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      {/* Version */}
      <div className="absolute bottom-3 right-3 text-xs text-[var(--muted)]">
        {APP_VERSION}
      </div>
    </div>
  );
}
