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
import DMPanel from "@/components/DMPanel";
import FriendPanel from "@/components/FriendPanel";
import { connectSocket, disconnectSocket } from "@/lib/socket";
import { displayName } from "@/lib/utils";

import { useAuth } from "@/hooks/useAuth";
import { useServers } from "@/hooks/useServers";
import { useChannels } from "@/hooks/useChannels";
import { usePresence } from "@/hooks/usePresence";
import { useVoice } from "@/hooks/useVoice";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

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

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [dmOpen, setDmOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);

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

  // Init: fetch user + servers, connect socket, restore URL selection
  useEffect(() => {
    async function init() {
      const user = await auth.fetchUser();
      if (!user) return;

      const serverList = await srv.fetchServers();
      connectSocket();

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
    <div className="h-screen flex bg-[var(--bg)]">
      {/* Server rail */}
      <ServerList
        servers={srv.servers}
        activeServerId={dmOpen ? undefined : srv.activeServer?.id}
        dmActive={dmOpen}
        friendsActive={friendsOpen}
        onDmClick={() => { setDmOpen((p) => !p); setFriendsOpen(false); }}
        onFriendsClick={() => { setFriendsOpen((p) => !p); setDmOpen(false); }}
        onServerSelect={(s) => { setDmOpen(false); setFriendsOpen(false); handleServerSelect(s); }}
        onServerCreated={handleServerCreated}
        onServerJoined={handleServerJoined}
      />

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
      {/* Channel sidebar */}
      {srv.activeServer ? (
        <ChannelList
          serverName={srv.activeServer.name}
          channels={srv.activeServer.channels}
          activeChannelId={ch.activeChannel?.id}
          serverId={srv.activeServer.id}
          unreadCounts={ch.unreadCounts}
          currentUserId={auth.user?.id}
          currentUserRole={presence.userRole}
          activeVoiceChannelId={voice.activeVoiceChannel?.id}
          voiceParticipants={voice.voiceParticipants}
          onChannelSelect={ch.selectChannel}
          onChannelCreated={handleChannelCreated}
          onVoiceJoin={voice.joinVoice}
          onVoiceLeave={voice.leaveVoice}
          onServerRenamed={handleServerRenamed}
          onServerDeleted={handleServerDeleted}
        />
      ) : (
        <div className="w-60 bg-[var(--panel)] flex flex-col items-center justify-center text-[var(--muted)] text-sm border-r border-[var(--accent-2)]/30 px-4 text-center gap-3 shrink-0">
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

      {/* Right sidebar: members or search */}
      {srv.activeServer && !searchOpen && (
        <MemberList
          serverId={srv.activeServer.id}
          onlineMemberIds={presence.onlineMembers}
          memberStatuses={presence.memberStatuses}
          currentUserId={auth.user?.id}
          currentUserRole={presence.userRole}
        />
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

      {/* User bar */}
      <div className="absolute bottom-0 left-[72px] w-60 h-12 bg-[var(--bg)] border-t border-r border-[var(--accent-2)]/30 flex items-center px-3 justify-between z-10">
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
                <div className="absolute bottom-full left-0 mb-2 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl py-1 w-36 z-50">
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
