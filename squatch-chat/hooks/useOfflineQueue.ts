"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { getSocket } from "@/lib/socket";

const STORAGE_KEY = "squatch:offline-queue";

interface QueuedMessage {
  id: string;
  channelId: string;
  content: string;
  timestamp: number;
  status: "pending" | "sending" | "failed";
}

function loadQueue(): QueuedMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveQueue(queue: QueuedMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {}
}

export function useOfflineQueue(sendMessage: (channelId: string, content: string) => Promise<boolean>) {
  const [queue, setQueue] = useState<QueuedMessage[]>([]);
  const [isOnline, setIsOnline] = useState(true);
  const processingRef = useRef(false);

  useEffect(() => {
    setQueue(loadQueue());
  }, []);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    const currentQueue = loadQueue();
    if (currentQueue.length === 0) { processingRef.current = false; return; }

    const remaining: QueuedMessage[] = [];
    for (const msg of currentQueue) {
      try {
        const success = await sendMessage(msg.channelId, msg.content);
        if (!success) remaining.push({ ...msg, status: "failed" });
      } catch {
        remaining.push({ ...msg, status: "failed" });
      }
    }

    saveQueue(remaining);
    setQueue(remaining);
    processingRef.current = false;
  }, [sendMessage]);

  useEffect(() => {
    const socket = getSocket();

    function handleConnect() {
      setIsOnline(true);
      // Auto-send queued messages
      processQueue();
    }

    function handleDisconnect() {
      setIsOnline(false);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    setIsOnline(socket.connected);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [processQueue]);

  const enqueue = useCallback((channelId: string, content: string) => {
    const msg: QueuedMessage = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      channelId,
      content,
      timestamp: Date.now(),
      status: "pending",
    };
    setQueue(prev => {
      const next = [...prev, msg];
      saveQueue(next);
      return next;
    });
    return msg.id;
  }, []);

  const clearQueue = useCallback(() => {
    saveQueue([]);
    setQueue([]);
  }, []);

  return { queue, isOnline, enqueue, processQueue, clearQueue };
}
