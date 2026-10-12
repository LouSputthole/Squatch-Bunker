"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

  // Surface unreads in the tab title so a backgrounded tab still signals activity.
  // Only channels that exist in the active server count, like the sidebar badges:
  // stored entries for deleted channels or a previous account must not pin "(n)".
  useEffect(() => {
    let total = 0;
    for (const channel of activeServer?.channels ?? []) {
      total += unreadCounts.get(channel.id) ?? 0;
    }
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) Campfire` : "Campfire";
    return () => { document.title = "Campfire"; };
  }, [unreadCounts, activeServer]);

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

  // Unread tracking. Subscriptions are diffed by channel id, so a channel
  // create/rename/reorder (which recreates the server object) or switching the
  // active channel no longer leaves and rejoins every channel room.
  const activeChannelIdRef = useRef(activeChannelId);
  const subscriptionsRef = useRef(new Map<string, () => void>());
  const textChannelKey = (activeServer?.channels ?? [])
    .filter((c) => !c.type || c.type === "text")
    .map((c) => c.id)
    .join(",");

  useEffect(() => {
    const socket = getSocket();
    const subscriptions = subscriptionsRef.current;
    const wanted = new Set(textChannelKey ? textChannelKey.split(",") : []);
    for (const [id, handler] of subscriptions) {
      if (wanted.has(id)) continue;
      socket.off(`message:channel:${id}`, handler);
      socket.emit("channel:leave", id);
      subscriptions.delete(id);
    }
    for (const id of wanted) {
      if (subscriptions.has(id)) continue;
      const handler = () => {
        if (id === activeChannelIdRef.current) return;
        setUnreadCounts((prev) => {
          const next = new Map(prev);
          next.set(id, (next.get(id) || 0) + 1);
          return next;
        });
      };
      socket.on(`message:channel:${id}`, handler);
      socket.emit("channel:join", id);
      subscriptions.set(id, handler);
    }
  }, [textChannelKey]);

  // Leave everything on unmount; rejoin everything after a reconnect (the new
  // server-side socket starts out in no channel rooms).
  useEffect(() => {
    const socket = getSocket();
    const subscriptions = subscriptionsRef.current;
    function rejoin() {
      for (const id of subscriptions.keys()) socket.emit("channel:join", id);
    }
    socket.on("connect", rejoin);
    return () => {
      socket.off("connect", rejoin);
      for (const [id, handler] of subscriptions) {
        socket.off(`message:channel:${id}`, handler);
        socket.emit("channel:leave", id);
      }
      subscriptions.clear();
    };
  }, []);

  // ChatPanel leaves its channel room when it switches away; the unread
  // subscription for that channel still needs the room, so take it back.
  const previousActiveChannelIdRef = useRef(activeChannelId);
  useEffect(() => {
    activeChannelIdRef.current = activeChannelId;
    const previous = previousActiveChannelIdRef.current;
    previousActiveChannelIdRef.current = activeChannelId;
    if (previous && previous !== activeChannelId && subscriptionsRef.current.has(previous)) {
      getSocket().emit("channel:join", previous);
    }
  }, [activeChannelId]);

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
