"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSocket } from "@/lib/socket";

/**
 * Total unread direct messages for the DM rail/tab badge.
 *
 * While the DM panel is closed this polls GET /api/dm/unread on load, on
 * socket (re)connect and whenever a `dm:notification` arrives. While the
 * panel is open, DMPanel is the source of truth: pass `setTotal` as its
 * `onUnreadChange` and this hook ignores socket events so the two never race.
 */
export function useDmUnread(userId: string | null | undefined, panelOpen: boolean) {
  const [total, setTotal] = useState(0);
  const panelOpenRef = useRef(panelOpen);

  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/dm/unread");
      if (!res.ok) return;
      const data = (await res.json()) as { total?: unknown };
      if (!panelOpenRef.current && typeof data.total === "number") setTotal(data.total);
    } catch {
      // Keep the last known count; the next event or reconnect retries.
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    const timer = setTimeout(() => { void refresh(); }, 0);
    const socket = getSocket();
    function handleDm(message: { authorId?: string }) {
      if (panelOpenRef.current || message?.authorId === userId) return;
      void refresh();
    }
    function handleConnect() {
      if (!panelOpenRef.current) void refresh();
    }
    socket.on("dm:notification", handleDm);
    socket.on("connect", handleConnect);
    return () => {
      clearTimeout(timer);
      socket.off("dm:notification", handleDm);
      socket.off("connect", handleConnect);
    };
  }, [userId, refresh]);

  return { total: userId ? total : 0, setTotal };
}
