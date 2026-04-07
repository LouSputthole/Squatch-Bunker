"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import ServerList from "@/components/ServerList";
import ChannelList from "@/components/ChannelList";
import ChatPanel from "@/components/ChatPanel";
import MemberList from "@/components/MemberList";
import VoicePanel, { VoicePanelHandle } from "@/components/VoicePanel";
import VoiceRoom from "@/components/VoiceRoom";
import SettingsModal from "@/components/SettingsModal";
import { SettingsIcon } from "@/components/VoicePanel";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";
import { displayName } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import SearchPanel from "@/components/SearchPanel";

interface Channel {
  id: string;
  name: string;
  type?: string;
}

interface Server {
  id: string;
  name: string;
  channels: Channel[];
  _count: { members: number };
}

interface User {
  id: string;
  username: string;
  email: string;
  avatar?: string | null;
}

interface VoiceParticipant {
  userId: string;
  username: string;
  muted: boolean;
  deafened?: boolean;
  avatar?: string | null;
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--muted)] gap-3">
        <img src="/campfire-logo.png" alt="Campfire" className="w-16 h-16 animate-pulse" />
        <span>Following tracks into the woods...</span>
      </div>
    }>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const APP_VERSION = "v0.0.4";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [onlineMembers, setOnlineMembers] = useState<Set<string>>(new Set());
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Voice state
  const [activeVoiceChannel, setActiveVoiceChannel] = useState<Channel | null>(null);
  const [voiceParticipants, setVoiceParticipants] = useState<Map<string, VoiceParticipant[]>>(new Map());
  const [voiceState, setVoiceState] = useState({ muted: false, deafened: false, participants: [] as VoiceParticipant[] });

  const activeServerIdRef = useRef<string | null>(null);
  const activeChannelIdRef = useRef<string | null>(null);
  const voicePanelRef = useRef<VoicePanelHandle>(null);

  const urlServerId = searchParams.get("s");
  const urlChannelId = searchParams.get("c");

  const updateUrl = useCallback((serverId?: string, channelId?: string) => {
    const params = new URLSearchParams();
    if (serverId) params.set("s", serverId);
    if (channelId) params.set("c", channelId);
    const query = params.toString();
    const newUrl = query ? `${pathname}?${query}` : pathname;
    window.history.replaceState(null, "", newUrl);
  }, [pathname]);

  // Fetch user and servers on mount
  useEffect(() => {
    let presenceHandler: ((data: { serverId: string; members: { userId: string; username: string }[] }) => void) | null = null;

    async function init() {
      try {
        const [userRes, serversRes] = await Promise.all([
          fetch("/api/auth/me"),
          fetch("/api/servers"),
        ]);

        if (!userRes.ok) {
          router.push("/login");
          return;
        }

        const userData = await userRes.json();
        const serversData = await serversRes.json();

        setUser(userData.user);
        const serverList: Server[] = serversData.servers || [];
        setServers(serverList);

        const socket = connectSocket();

        presenceHandler = (data: { serverId: string; members: { userId: string; username: string }[] }) => {
          if (data.serverId !== activeServerIdRef.current) return;
          setOnlineMembers(new Set(data.members.map((m) => m.userId)));
        };
        socket.on("presence:update", presenceHandler);

        // Restore selection from URL — only select text channels as active
        if (urlServerId && serverList.length > 0) {
          const savedServer = serverList.find((s) => s.id === urlServerId);
          if (savedServer) {
            setActiveServer(savedServer);
            const textChannels = savedServer.channels.filter((c) => !c.type || c.type === "text");
            const savedChannel = urlChannelId
              ? textChannels.find((c) => c.id === urlChannelId)
              : textChannels[0];
            if (savedChannel) setActiveChannel(savedChannel);
          } else {
            setActiveServer(serverList[0]);
            const textChannels = serverList[0].channels.filter((c) => !c.type || c.type === "text");
            if (textChannels.length > 0) setActiveChannel(textChannels[0]);
          }
        } else if (serverList.length > 0) {
          setActiveServer(serverList[0]);
          const textChannels = serverList[0].channels.filter((c) => !c.type || c.type === "text");
          if (textChannels.length > 0) setActiveChannel(textChannels[0]);
        }

        setLoading(false);
      } catch {
        router.push("/login");
      }
    }

    init();

    return () => {
      if (presenceHandler) {
        getSocket().off("presence:update", presenceHandler);
      }
      disconnectSocket();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    activeServerIdRef.current = activeServer?.id ?? null;
  }, [activeServer]);

  useEffect(() => {
    activeChannelIdRef.current = activeChannel?.id ?? null;
    if (activeChannel) {
      setUnreadCounts((prev) => {
        if (!prev.has(activeChannel.id)) return prev;
        const next = new Map(prev);
        next.delete(activeChannel.id);
        return next;
      });
    }
  }, [activeChannel]);

  useEffect(() => {
    if (activeServer || activeChannel) {
      updateUrl(activeServer?.id, activeChannel?.id);
    }
  }, [activeServer, activeChannel, updateUrl]);

  useEffect(() => {
    if (!activeServer) return;
    const socket = getSocket();
    socket.emit("server:join", activeServer.id);
    return () => { socket.emit("server:leave", activeServer.id); };
  }, [activeServer]);

  // Global voice participants listener — receives updates via server room broadcast
  useEffect(() => {
    if (!activeServer) return;
    const socket = getSocket();

    function handleVoiceUpdate(data: { channelId: string; participants: VoiceParticipant[] }) {
      // Only update for voice channels in this server
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

  // Unread tracking — only for text channels
  useEffect(() => {
    if (!activeServer || activeServer.channels.length === 0) return;
    const socket = getSocket();
    const textChannelIds = activeServer.channels
      .filter((c) => !c.type || c.type === "text")
      .map((c) => c.id);

    textChannelIds.forEach((id) => socket.emit("channel:join", id));

    function handleMessage(channelId: string) {
      return () => {
        if (channelId === activeChannelIdRef.current) return;
        setUnreadCounts((prev) => {
          const next = new Map(prev);
          next.set(channelId, (next.get(channelId) || 0) + 1);
          return next;
        });
      };
    }

    const handlers = textChannelIds.map((id) => ({
      event: `message:channel:${id}`,
      handler: handleMessage(id),
    }));
    handlers.forEach(({ event, handler }) => socket.on(event, handler));

    return () => {
      handlers.forEach(({ event, handler }) => socket.off(event, handler));
      textChannelIds.forEach((id) => socket.emit("channel:leave", id));
    };
  }, [activeServer]);

  const handleServerSelect = useCallback((server: Server) => {
    setActiveServer(server);
    const textChannels = server.channels.filter((c) => !c.type || c.type === "text");
    setActiveChannel(textChannels[0] || null);
    setOnlineMembers(new Set());
    setUnreadCounts(new Map());
  }, []);

  const activateServer = useCallback((server: Server) => {
    setServers((prev) => {
      if (prev.some((s) => s.id === server.id)) return prev;
      return [...prev, server];
    });
    setActiveServer(server);
    const textChannels = server.channels.filter((c) => !c.type || c.type === "text");
    if (textChannels.length > 0) setActiveChannel(textChannels[0]);
  }, []);

  const handleServerCreated = useCallback((server: Server) => {
    activateServer(server);
  }, [activateServer]);

  const handleServerJoined = useCallback((server: Server) => {
    activateServer(server);
  }, [activateServer]);

  const handleChannelSelect = useCallback((channel: Channel) => {
    // Only text channels become the active text channel
    if (!channel.type || channel.type === "text") {
      setActiveChannel(channel);
    }
  }, []);

  const handleChannelCreated = useCallback((channel: Channel) => {
    setActiveServer((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, channels: [...prev.channels, channel] };
      setServers((servers) =>
        servers.map((s) => (s.id === updated.id ? updated : s))
      );
      return updated;
    });
    // Only auto-select text channels
    if (!channel.type || channel.type === "text") {
      setActiveChannel(channel);
    }
  }, []);

  const handleVoiceJoin = useCallback((channel: Channel) => {
    // If already in a voice channel, leave it first (VoicePanel unmount handles cleanup)
    setActiveVoiceChannel(channel);
  }, []);

  const handleVoiceLeave = useCallback(() => {
    setActiveVoiceChannel(null);
  }, []);

  const handleVoiceParticipantsChange = useCallback((channelId: string, participants: VoiceParticipant[]) => {
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

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    disconnectSocket();
    router.push("/login");
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl/Cmd+K: toggle search
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        return;
      }

      // Ctrl/Cmd+M: toggle mute (when in voice)
      if ((e.ctrlKey || e.metaKey) && e.key === "m") {
        if (activeVoiceChannel && voicePanelRef.current) {
          e.preventDefault();
          voicePanelRef.current.toggleMute();
        }
        return;
      }

      // Ctrl/Cmd+D: toggle deafen (when in voice)
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        if (activeVoiceChannel && voicePanelRef.current) {
          e.preventDefault();
          voicePanelRef.current.toggleDeafen();
        }
        return;
      }

      // Escape: close search or settings
      if (e.key === "Escape") {
        if (searchOpen) { setSearchOpen(false); return; }
        if (settingsOpen) { setSettingsOpen(false); return; }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeVoiceChannel, searchOpen, settingsOpen]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--muted)] gap-3">
        <img src="/campfire-logo.png" alt="Campfire" className="w-16 h-16 animate-pulse" />
        <span>Following tracks into the woods...</span>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-[var(--bg)]">
      <ServerList
        servers={servers}
        activeServerId={activeServer?.id}
        onServerSelect={handleServerSelect}
        onServerCreated={handleServerCreated}
        onServerJoined={handleServerJoined}
      />

      {activeServer ? (
        <ChannelList
          serverName={activeServer.name}
          channels={activeServer.channels}
          activeChannelId={activeChannel?.id}
          serverId={activeServer.id}
          unreadCounts={unreadCounts}
          currentUserId={user?.id}
          activeVoiceChannelId={activeVoiceChannel?.id}
          voiceParticipants={voiceParticipants}
          onChannelSelect={handleChannelSelect}
          onChannelCreated={handleChannelCreated}
          onVoiceJoin={handleVoiceJoin}
          onVoiceLeave={handleVoiceLeave}
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

      {/* Main panel: Voice Room takes over when in voice, otherwise show text chat */}
      {activeVoiceChannel && user ? (
        <VoiceRoom
          channelName={activeVoiceChannel.name}
          participants={voiceState.participants}
          currentUserId={user.id}
          muted={voiceState.muted}
          deafened={voiceState.deafened}
          onToggleMute={() => voicePanelRef.current?.toggleMute()}
          onToggleDeafen={() => voicePanelRef.current?.toggleDeafen()}
          onDisconnect={() => voicePanelRef.current?.disconnect()}
        />
      ) : activeChannel && user ? (
        <ChatPanel
          channelId={activeChannel.id}
          channelName={activeChannel.name}
          currentUserId={user.id}
          currentUsername={user.username}
          currentAvatar={user.avatar}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[var(--panel-2)] text-[var(--muted)]">
          <div className="text-center max-w-sm">
            <img src="/campfire-logo.png" alt="Campfire" className="w-20 h-20 mx-auto mb-4 opacity-80" />
            <p className="text-2xl mb-2 text-[var(--text)]">Welcome to Campfire</p>
            {servers.length === 0 ? (
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

      {activeServer && !searchOpen && (
        <MemberList
          serverId={activeServer.id}
          onlineMemberIds={onlineMembers}
        />
      )}

      {searchOpen && activeServer && (
        <SearchPanel
          serverId={activeServer.id}
          onClose={() => setSearchOpen(false)}
          onJumpToMessage={(channelId) => {
            const ch = activeServer.channels.find((c) => c.id === channelId);
            if (ch) setActiveChannel(ch);
            setSearchOpen(false);
          }}
        />
      )}

      {/* Voice Panel — floating bar above user bar */}
      {/* VoicePanel handles WebRTC — hidden but active when in voice */}
      {activeVoiceChannel && user && (
        <VoicePanel
          ref={voicePanelRef}
          channelId={activeVoiceChannel.id}
          channelName={activeVoiceChannel.name}
          serverId={activeServer?.id || ""}
          currentUserId={user.id}
          onParticipantsChange={handleVoiceParticipantsChange}
          onDisconnect={handleVoiceLeave}
          onStateChange={setVoiceState}
        />
      )}

      {/* User bar with settings gear */}
      <div className="absolute bottom-0 left-[72px] w-60 h-12 bg-[var(--bg)] border-t border-r border-[var(--accent-2)]/30 flex items-center px-3 justify-between z-10">
        <div className="flex items-center gap-2 min-w-0">
          {user && (
            <Avatar
              username={user.username}
              avatarUrl={user.avatar}
              size={28}
              className="bg-[var(--accent-2)] text-[var(--text)]"
            />
          )}
          <span className="text-sm text-[var(--text)] truncate">
            {user ? displayName(user.username) : ""}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            title="Search"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            title="Settings"
          >
            <SettingsIcon />
          </button>
          <button
            onClick={handleLogout}
            className="text-xs text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        username={user?.username}
        currentAvatar={user?.avatar}
        onAvatarChange={(avatar) => setUser((prev) => prev ? { ...prev, avatar } : prev)}
      />

      {/* App version */}
      <div className="absolute bottom-3 right-3 text-xs text-[var(--muted)]">
        {APP_VERSION}
      </div>
    </div>
  );
}
