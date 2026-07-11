"use client";
import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "squatch:muted-channels";

function loadMuted(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveMuted(muted: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...muted]));
  } catch {}
}

export function useMutedChannels() {
  const [mutedChannels, setMutedChannels] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMutedChannels(loadMuted());
  }, []);

  const toggleMute = useCallback((channelId: string) => {
    setMutedChannels(prev => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      saveMuted(next);
      return next;
    });
  }, []);

  const isMuted = useCallback((channelId: string) => mutedChannels.has(channelId), [mutedChannels]);

  return { mutedChannels, toggleMute, isMuted };
}
