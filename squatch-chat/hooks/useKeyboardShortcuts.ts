"use client";

import { useEffect } from "react";
import type { Channel } from "@/types/chat";

interface ShortcutDeps {
  activeVoiceChannel: Channel | null;
  searchOpen: boolean;
  settingsOpen: boolean;
  setSearchOpen: (fn: (prev: boolean) => boolean) => void;
  setSettingsOpen: (val: boolean) => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
}

export function useKeyboardShortcuts({
  activeVoiceChannel,
  searchOpen,
  settingsOpen,
  setSearchOpen,
  setSettingsOpen,
  toggleMute,
  toggleDeafen,
}: ShortcutDeps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ctrl/Cmd+K: toggle search
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        return;
      }

      // Ctrl/Cmd+M: toggle mute
      if ((e.ctrlKey || e.metaKey) && e.key === "m") {
        if (activeVoiceChannel) {
          e.preventDefault();
          toggleMute();
        }
        return;
      }

      // Ctrl/Cmd+D: toggle deafen
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        if (activeVoiceChannel) {
          e.preventDefault();
          toggleDeafen();
        }
        return;
      }

      // Escape: close overlays
      if (e.key === "Escape") {
        if (searchOpen) { setSearchOpen(() => false); return; }
        if (settingsOpen) { setSettingsOpen(false); return; }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeVoiceChannel, searchOpen, settingsOpen, setSearchOpen, setSettingsOpen, toggleMute, toggleDeafen]);
}
