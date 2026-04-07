"use client";
import { useState, useCallback } from "react";

interface QueuedMessage {
  id: string;
  channelId: string;
  content: string;
  timestamp: number;
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
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId: msg.channelId, content: msg.content }),
        });
      } catch {
        // Re-queue on failure
        setQueue(prev => [...prev, msg]);
      }
    }
  }, [queue]);

  const clear = useCallback(() => setQueue([]), []);

  return { queue, queuedCount: queue.length, enqueue, flush, clear };
}
