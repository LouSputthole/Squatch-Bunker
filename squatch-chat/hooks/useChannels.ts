"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getSocket } from "@/lib/socket";
import type { Channel, Server } from "@/types/chat";

export function useChannels(activeServer: Server | null) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(new Map());
  const activeChannelIdRef = useRef<string | null>(null);

  const urlServerId = searchParams.get("s");
  const urlChannelId = searchParams.get("c");

  // Sync ref
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

  // URL sync
  const updateUrl = useCallback((serverId?: string, channelId?: string) => {
    const params = new URLSearchParams();
    if (serverId) params.set("s", serverId);
    if (channelId) params.set("c", channelId);
    const query = params.toString();
    const newUrl = query ? `${pathname}?${query}` : pathname;
    window.history.replaceState(null, "", newUrl);
  }, [pathname]);

  useEffect(() => {
    if (activeServer || activeChannel) {
      updateUrl(activeServer?.id, activeChannel?.id);
    }
  }, [activeServer, activeChannel, updateUrl]);

  // Unread tracking
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

  const selectChannel = useCallback((channel: Channel) => {
    if (!channel.type || channel.type === "text") {
      setActiveChannel(channel);
    }
  }, []);

  const resetUnreads = useCallback(() => {
    setUnreadCounts(new Map());
  }, []);

  return {
    activeChannel,
    setActiveChannel,
    unreadCounts,
    urlServerId,
    urlChannelId,
    selectChannel,
    resetUnreads,
  };
}
