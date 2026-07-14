"use client";
import { useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";

export interface QueuedMessage {
  id: string;
  channelId: string;
  content: string;
  timestamp: number;
}

export async function flushOfflineMessage(
  message: QueuedMessage,
  request: typeof fetch = fetch,
): Promise<void> {
  const response = await request("/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channelId: message.channelId,
      content: message.content,
    }),
  });
  if (!response.ok) return;

  const payload = await response.json().catch(() => null) as {
    message?: unknown;
  } | null;
  const persisted = payload?.message;
  if (
    typeof persisted !== "object" ||
    persisted === null ||
    typeof (persisted as { id?: unknown }).id !== "string" ||
    (persisted as { channelId?: unknown }).channelId !== message.channelId
  ) {
    return;
  }

  // Only announce the exact row returned by persistence. The realtime handler
  // independently verifies its id, channel, and authenticated author before
  // relaying it, so queued client ids cannot forge a broadcast.
  getSocket().emit("message:send", {
    channelId: message.channelId,
    message: persisted,
  });
}

export function useOfflineQueue() {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);

  const enqueue = useCallback((channelId: string, content: string) => {
    const msg: QueuedMessage = {
      id: crypto.randomUUID(),
      channelId,
      content,
      timestamp: Date.now(),
    };
    setQueue(prev => [...prev, msg]);
    return msg.id;
  }, []);

  const flush = useCallback(async () => {
    if (queue.length === 0) return;
    const toSend = [...queue];
    setQueue([]);

    for (const msg of toSend) {
      try {
        await flushOfflineMessage(msg);
      } catch {
        // Re-queue on failure
        setQueue(prev => [...prev, msg]);
      }
    }
  }, [queue]);

  const clear = useCallback(() => setQueue([]), []);

  return { queue, queuedCount: queue.length, enqueue, flush, clear };
}
