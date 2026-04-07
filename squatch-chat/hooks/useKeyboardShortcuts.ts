"use client";

import { useEffect } from "react";
import type { Channel } from "@/types/chat";

interface ShortcutDeps {
  activeVoiceChannel: Channel | null;
  searchOpen: boolean;
  settingsOpen: boolean;
  shortcutsOpen?: boolean;
  setSearchOpen: (fn: (prev: boolean) => boolean) => void;
  setSettingsOpen: (val: boolean) => void;
  setShortcutsOpen?: (fn: (prev: boolean) => boolean) => void;
  toggleMute: () => void;
  toggleDeafen: () => void;
}

export function useKeyboardShortcuts({
  activeVoiceChannel,
  searchOpen,
  settingsOpen,
  shortcutsOpen,
  setSearchOpen,
  setSettingsOpen,
  setShortcutsOpen,
  toggleMute,
  toggleDeafen,
}: ShortcutDeps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable;

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

      // ?: toggle shortcuts panel (only when not typing)
      if (e.key === "?" && !isInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen?.((prev) => !prev);
        return;
      }

      // Escape: close overlays
      if (e.key === "Escape") {
        if (shortcutsOpen) { setShortcutsOpen?.(() => false); return; }
        if (searchOpen) { setSearchOpen(() => false); return; }
        if (settingsOpen) { setSettingsOpen(false); return; }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeVoiceChannel, searchOpen, settingsOpen, shortcutsOpen, setSearchOpen, setSettingsOpen, setShortcutsOpen, toggleMute, toggleDeafen]);
}
