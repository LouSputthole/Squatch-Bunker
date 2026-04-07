"use client";

import { useEffect } from "react";

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ["Ctrl", "K"], description: "Open / close message search" },
  { keys: ["Ctrl", "M"], description: "Toggle microphone mute (in voice)" },
  { keys: ["Ctrl", "D"], description: "Toggle deafen (in voice)" },
  { keys: ["Space"], description: "Push-to-talk while held (PTT mode)" },
  { keys: ["?"], description: "Show this shortcuts panel" },
  { keys: ["Esc"], description: "Close open panels / search" },
  { keys: ["Enter"], description: "Send message" },
  { keys: ["↑"], description: "Edit last sent message" },
];

export default function KeyboardShortcutsPanel({ open, onClose }: KeyboardShortcutsPanelProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-[var(--panel)] rounded-lg shadow-2xl w-full max-w-md border border-[var(--accent-2)]/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--accent-2)]/30">
          <h2 className="text-lg font-bold text-[var(--text)]">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Shortcut list */}
        <div className="px-6 py-4 space-y-1">
          {SHORTCUTS.map(({ keys, description }) => (
            <div key={description} className="flex items-center justify-between py-2 border-b border-[var(--accent-2)]/10 last:border-0">
              <span className="text-sm text-[var(--text)]">{description}</span>
              <span className="flex items-center gap-1 shrink-0 ml-4">
                {keys.map((k, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <kbd className="px-2 py-0.5 text-xs font-mono bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/40 rounded shadow-sm">
                      {k}
                    </kbd>
                    {i < keys.length - 1 && <span className="text-xs text-[var(--muted)]">+</span>}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>

        <div className="px-6 pb-4 text-xs text-[var(--muted)]">
          Press <kbd className="px-1 py-0.5 bg-[var(--panel-2)] border border-[var(--accent-2)]/40 rounded">?</kbd> anywhere to toggle this panel.
        </div>
      </div>
    </div>
  );
}
