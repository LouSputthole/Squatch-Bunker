"use client";

import { Suspense, useEffect, useState, useCallback, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import ServerList from "@/components/ServerList";
import ChannelList from "@/components/ChannelList";
import ChatPanel from "@/components/ChatPanel";
import MemberList from "@/components/MemberList";
import { connectSocket, disconnectSocket, getSocket } from "@/lib/socket";

interface Channel {
  id: string;
  name: string;
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
}

export default function ChatPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--muted)]">
        Following tracks into the woods...
      </div>
    }>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const APP_VERSION = "v0.0.2";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [user, setUser] = useState<User | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [onlineMembers, setOnlineMembers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const activeServerIdRef = useRef<string | null>(null);

  // Read server/channel IDs from URL on mount
  const urlServerId = searchParams.get("s");
  const urlChannelId = searchParams.get("c");

  // Update URL when selection changes (without navigation)
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

        // Connect socket
        const socket = connectSocket();
        socket.emit("auth:identify", {
          userId: userData.user.id,
          username: userData.user.username,
        });

        // Listen for presence updates
        presenceHandler = (data: { serverId: string; members: { userId: string; username: string }[] }) => {
          if (data.serverId !== activeServerIdRef.current) return;
          setOnlineMembers(new Set(data.members.map((m) => m.userId)));
        };
        socket.on("presence:update", presenceHandler);

        // Restore selection from URL
        if (urlServerId && serverList.length > 0) {
          const savedServer = serverList.find((s) => s.id === urlServerId);
          if (savedServer) {
            setActiveServer(savedServer);
            const savedChannel = urlChannelId
              ? savedServer.channels.find((c) => c.id === urlChannelId)
              : savedServer.channels[0];
            if (savedChannel) setActiveChannel(savedChannel);
          } else {
            // URL server not found, fall back to first
            setActiveServer(serverList[0]);
            if (serverList[0].channels.length > 0) {
              setActiveChannel(serverList[0].channels[0]);
            }
          }
        } else if (serverList.length > 0) {
          setActiveServer(serverList[0]);
          if (serverList[0].channels.length > 0) {
            setActiveChannel(serverList[0].channels[0]);
          }
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

  // Update URL when active server/channel changes
  useEffect(() => {
    if (activeServer || activeChannel) {
      updateUrl(activeServer?.id, activeChannel?.id);
    }
  }, [activeServer, activeChannel, updateUrl]);

  // Join server room for presence when active server changes
  useEffect(() => {
    if (!activeServer) return;
    const socket = getSocket();
    socket.emit("server:join", activeServer.id);

    return () => {
      socket.emit("server:leave", activeServer.id);
    };
  }, [activeServer]);

  const handleServerSelect = useCallback((server: Server) => {
    setActiveServer(server);
    setActiveChannel(server.channels[0] || null);
    setOnlineMembers(new Set());
  }, []);

  const activateServer = useCallback((server: Server) => {
    setServers((prev) => {
      if (prev.some((s) => s.id === server.id)) return prev;
      return [...prev, server];
    });
    setActiveServer(server);
    if (server.channels.length > 0) {
      setActiveChannel(server.channels[0]);
    }
  }, []);

  const handleServerCreated = useCallback((server: Server) => {
    activateServer(server);
  }, [activateServer]);

  const handleServerJoined = useCallback((server: Server) => {
    activateServer(server);
  }, [activateServer]);

  const handleChannelSelect = useCallback((channel: Channel) => {
    setActiveChannel(channel);
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
    setActiveChannel(channel);
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    disconnectSocket();
    router.push("/login");
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] text-[var(--muted)]">
        Following tracks into the woods...
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
          onChannelSelect={handleChannelSelect}
          onChannelCreated={handleChannelCreated}
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

      {activeChannel && user ? (
        <ChatPanel
          channelId={activeChannel.id}
          channelName={activeChannel.name}
          currentUserId={user.id}
          currentUsername={user.username}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[var(--panel-2)] text-[var(--muted)]">
          <div className="text-center max-w-sm">
            <p className="text-2xl mb-2 text-[var(--text)]">Welcome to SquatchChat</p>
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

      {activeServer && (
        <MemberList
          serverId={activeServer.id}
          onlineMemberIds={onlineMembers}
        />
      )}

      <div className="absolute bottom-0 left-[72px] w-60 h-12 bg-[var(--bg)] border-t border-r border-[var(--accent-2)]/30 flex items-center px-3 justify-between z-10">
        <span className="text-sm text-[var(--text)] truncate">
          {user?.username}
        </span>
        <button
          onClick={handleLogout}
          className="text-xs text-[var(--muted)] hover:text-[var(--danger)] transition-colors"
        >
          Logout
        </button>
      </div>

      {/* App version */}
      <div className="absolute bottom-3 right-3 text-xs text-[var(--muted)]">
        {APP_VERSION}
      </div>
    </div>
  );
}
