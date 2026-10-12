"use client";

import { useEscape } from "@/hooks/useEscape";

interface KeyboardShortcutsPanelProps {
  open: boolean;
  onClose: () => void;
}

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUT_GROUPS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: ["Ctrl", "K"], description: "Open / close message search" },
      { keys: ["Ctrl", "/"], description: "Show / hide this shortcuts panel" },
      { keys: ["?"], description: "Show / hide this panel (when not typing)" },
      { keys: ["Esc"], description: "Close the open dialog, panel, or search" },
    ],
  },
  {
    title: "Messages",
    shortcuts: [
      { keys: ["Enter"], description: "Send message" },
      { keys: ["Shift", "Enter"], description: "New line" },
      { keys: ["↑"], description: "Edit your last message (empty message box)" },
      { keys: ["Enter"], description: "Save an edit (Shift + Enter for a new line)" },
      { keys: ["Esc"], description: "Cancel editing" },
      { keys: ["Tab"], description: "Pick the highlighted @mention (Enter works too)" },
      { keys: ["Esc"], description: "Cancel the reply you're writing" },
      { keys: ["Ctrl", "B"], description: "Bold the selected text" },
      { keys: ["Ctrl", "I"], description: "Italicize the selected text" },
      { keys: ["Ctrl", "K"], description: "Turn the selected text into a link (no selection: search)" },
      { keys: ["Shift", "Click"], description: "Delete a message without the confirmation (on the delete button)" },
    ],
  },
  {
    title: "Voice",
    shortcuts: [
      { keys: ["Ctrl", "M"], description: "Toggle microphone mute" },
      { keys: ["Ctrl", "D"], description: "Toggle deafen" },
      { keys: ["Space"], description: "Push-to-talk while held (PTT mode)" },
    ],
  },
];

export default function KeyboardShortcutsPanel({ open, onClose }: KeyboardShortcutsPanelProps) {
  useEscape(onClose, open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        className="bg-[var(--panel)] rounded-lg shadow-2xl w-full max-w-md border border-[var(--accent-2)]/30 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--accent-2)]/30 shrink-0">
          <h2 id="keyboard-shortcuts-title" className="text-lg font-bold text-[var(--text)]">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            autoFocus
            aria-label="Close keyboard shortcuts"
            title="Close"
            className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Shortcut list */}
        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{group.title}</h3>
              {group.shortcuts.map(({ keys, description }) => (
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
            </section>
          ))}
        </div>

        <div className="px-6 pb-4 pt-1 text-xs text-[var(--muted)] shrink-0">
          Press <kbd className="px-1 py-0.5 bg-[var(--panel-2)] border border-[var(--accent-2)]/40 rounded">?</kbd> anywhere to toggle this panel. On macOS, use ⌘ instead of Ctrl.
        </div>
      </div>
    </div>
  );
}
