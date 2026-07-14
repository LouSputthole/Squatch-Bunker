"use client";

import { useState, useEffect, useCallback } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getSocket } from "@/lib/socket";
import type { Channel, Server } from "@/types/chat";

const STORAGE_KEY = "squatch:unread";

function loadStoredUnreads(): Map<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, number>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function saveUnreads(counts: Map<string, number>) {
  try {
    const obj: Record<string, number> = {};
    counts.forEach((v, k) => { obj[k] = v; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // ignore
  }
}

export function useChannels(activeServer: Server | null) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeChannel, setActiveChannelState] = useState<Channel | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Map<string, number>>(() => loadStoredUnreads());

  const urlServerId = searchParams.get("s");
  const urlChannelId = searchParams.get("c");
  const activeChannelId = activeChannel?.id ?? null;

  const clearChannelUnread = useCallback((channelId: string) => {
    setUnreadCounts((prev) => {
      if (!prev.has(channelId)) return prev;
      const next = new Map(prev);
      next.delete(channelId);
      return next;
    });
  }, []);

  const setActiveChannel = useCallback((channel: Channel | null) => {
    setActiveChannelState(channel);
    if (channel) clearChannelUnread(channel.id);
  }, [clearChannelUnread]);

  // Persist unread counts to localStorage whenever they change
  useEffect(() => {
    saveUnreads(unreadCounts);
  }, [unreadCounts]);

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
        if (channelId === activeChannelId) return;
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
  }, [activeServer, activeChannelId]);

  const markChannelRead = useCallback((channelId: string) => {
    clearChannelUnread(channelId);
    try {
      localStorage.setItem(`lastRead:${channelId}`, new Date().toISOString());
    } catch { /* ignore */ }
  }, [clearChannelUnread]);

  const selectChannel = useCallback((channel: Channel) => {
    if (!channel.type || channel.type === "text") {
      setActiveChannel(channel);
      markChannelRead(channel.id);
    }
  }, [markChannelRead, setActiveChannel]);

  const resetUnreads = useCallback(() => {
    setUnreadCounts(new Map());
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }, []);

  return {
    activeChannel,
    setActiveChannel,
    unreadCounts,
    markChannelRead,
    urlServerId,
    urlChannelId,
    selectChannel,
    resetUnreads,
  };
}
