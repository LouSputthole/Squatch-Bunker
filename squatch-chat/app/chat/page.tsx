"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ServerList from "@/components/ServerList";
import ChannelList from "@/components/ChannelList";
import ChatPanel from "@/components/ChatPanel";
import { connectSocket, disconnectSocket } from "@/lib/socket";

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
        connectSocket("");

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

  function handleServerSelect(server: Server) {
    setActiveServer(server);
    setActiveChannel(server.channels[0] || null);
  }

  function handleServerCreated(server: Server) {
    setServers((prev) => [...prev, server]);
    setActiveServer(server);
    if (server.channels.length > 0) {
      setActiveChannel(server.channels[0]);
    }
  }

  function handleChannelSelect(channel: Channel) {
    setActiveChannel(channel);
  }

  function handleChannelCreated(channel: Channel) {
    if (activeServer) {
      const updated = {
        ...activeServer,
        channels: [...activeServer.channels, channel],
      };
      setActiveServer(updated);
      setServers((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
      setActiveChannel(channel);
    }
  }

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
      {/* Server rail */}
      <ServerList
        servers={servers}
        activeServerId={activeServer?.id}
        onServerSelect={handleServerSelect}
        onServerCreated={handleServerCreated}
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
        <div className="w-60 bg-[var(--panel)] flex items-center justify-center text-[var(--muted)] text-sm border-r border-[var(--accent-2)]/30">
          Create a server to get started
        </div>
      )}

      {/* Main chat area */}
      {activeChannel && user ? (
        <ChatPanel
          channelId={activeChannel.id}
          channelName={activeChannel.name}
          currentUserId={user.id}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center bg-[var(--panel-2)] text-[var(--muted)]">
          <div className="text-center">
            <p className="text-2xl mb-2">Welcome to SquatchChat</p>
            <p className="text-sm">Select a channel or create a server</p>
          </div>
        </div>
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
