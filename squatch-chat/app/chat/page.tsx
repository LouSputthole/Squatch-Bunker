"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [activeServer, setActiveServer] = useState<Server | null>(null);
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [onlineMembers, setOnlineMembers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  // Fetch user and servers on mount
  useEffect(() => {
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
        setServers(serversData.servers || []);

        // Connect socket
        const socket = connectSocket();

        // Identify to socket server
        socket.emit("auth:identify", {
          userId: userData.user.id,
          username: userData.user.username,
        });

        // Listen for presence updates
        socket.on("presence:update", (data: { serverId: string; members: { userId: string; username: string }[] }) => {
          setOnlineMembers(new Set(data.members.map((m) => m.userId)));
        });

        setLoading(false);
      } catch {
        router.push("/login");
      }
    }

    init();

    return () => {
      disconnectSocket();
    };
  }, [router]);

  // Auto-select first server and channel
  useEffect(() => {
    if (servers.length > 0 && !activeServer) {
      const first = servers[0];
      setActiveServer(first);
      if (first.channels.length > 0) {
        setActiveChannel(first.channels[0]);
      }
    }
  }, [servers, activeServer]);

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
      // Add if not already in list
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
      {/* Server rail + slide-out create/join panel */}
      <ServerList
        servers={servers}
        activeServerId={activeServer?.id}
        onServerSelect={handleServerSelect}
        onServerCreated={handleServerCreated}
        onServerJoined={handleServerJoined}
      />

      {/* Channel sidebar */}
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
        <div className="w-60 bg-[var(--panel)] flex flex-col items-center justify-center text-[var(--muted)] text-sm border-r border-[var(--accent-2)]/30 px-4 text-center gap-3">
          <p className="text-base text-[var(--text)]">No servers yet</p>
          <p className="text-xs">
            Use the <span className="text-[var(--accent)] font-bold">+</span> button to create a server
            or the <span className="text-[var(--accent)] font-bold">&#8618;</span> button to join one
          </p>
        </div>
      )}

      {/* Main chat area */}
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

      {/* Member list */}
      {activeServer && (
        <MemberList
          serverId={activeServer.id}
          onlineMemberIds={onlineMembers}
        />
      )}

      {/* User bar */}
      <div className="absolute bottom-0 left-[72px] w-60 h-12 bg-[var(--bg)] border-t border-r border-[var(--accent-2)]/30 flex items-center px-3 justify-between">
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
    </div>
  );
}
