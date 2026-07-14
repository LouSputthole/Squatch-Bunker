"use client";
import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "squatch:focus-mode";

interface FocusState {
  active: boolean;
  until: number | null;
  expired: boolean;
}

function loadFocusState(): FocusState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { active: false, until: null, expired: false };
    const data = JSON.parse(raw);
    if (!data.active) return { active: false, until: null, expired: false };
    if (data.until && Date.now() > data.until) {
      return { active: false, until: null, expired: true };
    }
    return { active: true, until: data.until ?? null, expired: false };
  } catch {
    return { active: false, until: null, expired: false };
  }
}

export function useFocusMode() {
  const [focusState, setFocusState] = useState<FocusState>(loadFocusState);

  useEffect(() => {
    if (!focusState.expired) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }, [focusState.expired]);

  const enable = useCallback((durationMinutes?: number) => {
    const until = durationMinutes ? Date.now() + durationMinutes * 60 * 1000 : null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ active: true, until }));
    } catch {}
    setFocusState({ active: true, until, expired: false });
  }, []);

  const disable = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setFocusState({ active: false, until: null, expired: false });
  }, []);

  const toggle = useCallback(() => {
    if (focusState.active) disable();
    else enable();
  }, [focusState.active, enable, disable]);

  return {
    focusMode: focusState.active,
    focusUntil: focusState.until,
    toggle,
    enable,
    disable,
  };
}
