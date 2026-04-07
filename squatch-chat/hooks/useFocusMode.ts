"use client";
import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "squatch:focus-mode";

export function useFocusMode() {
  const [focusMode, setFocusMode] = useState(false);
  const [focusUntil, setFocusUntil] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.active) {
        if (data.until && Date.now() > data.until) {
          // Expired
          localStorage.removeItem(STORAGE_KEY);
        } else {
          setFocusMode(true);
          setFocusUntil(data.until ?? null);
        }
      }
    } catch {}
  }, []);

  const enable = useCallback((durationMinutes?: number) => {
    const until = durationMinutes ? Date.now() + durationMinutes * 60 * 1000 : null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, until }));
    } catch {}
    setFocusMode(true);
    setFocusUntil(until);
  }, []);

  const disable = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setFocusMode(false);
    setFocusUntil(null);
  }, []);

  const toggle = useCallback(() => {
    if (focusMode) disable();
    else enable();
  }, [focusMode, enable, disable]);

  return { focusMode, focusUntil, toggle, enable, disable };
}
