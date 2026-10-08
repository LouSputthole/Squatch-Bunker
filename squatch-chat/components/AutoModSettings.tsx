"use client";

import { useState, useEffect } from "react";
import { useEscape } from "@/hooks/useEscape";
import { toast } from "@/lib/toast";

interface AutoModSettingsProps {
  serverId: string;
  open: boolean;
  onClose: () => void;
}

const DEFAULT_WORDS = [
  "spam", "scam", "phishing", "malware",
];

/**
 * Word filter settings. Honest scope: these live in this browser's
 * localStorage and only stop messages *you* send from this device — there is
 * no server-side enforcement yet, so there is no delete/warn/mute action.
 */
export default function AutoModSettings({ serverId, open, onClose }: AutoModSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");
  const [saved, setSaved] = useState(false);

  useEscape(onClose, open);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const key = `campfire-automod-${serverId}`;
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          const data = JSON.parse(saved);
          setEnabled(data.enabled ?? false);
          setWords(data.words ?? []);
        }
      } catch { /* ignore */ }
    }, 0);
    return () => clearTimeout(timer);
  }, [open, serverId]);

  function save() {
    const key = `campfire-automod-${serverId}`;
    try {
      localStorage.setItem(key, JSON.stringify({ enabled, words }));
    } catch {
      toast("Couldn't save the word filter on this device", "error");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function addWord() {
    const w = newWord.trim().toLowerCase();
    if (!w || words.includes(w)) return;
    setWords([...words, w]);
    setNewWord("");
  }

  function removeWord(word: string) {
    setWords(words.filter((w) => w !== word));
  }

  function loadDefaults() {
    setWords([...new Set([...words, ...DEFAULT_WORDS])]);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="automod-title"
        className="w-full max-w-md bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--accent-2)]/20">
          <h2 id="automod-title" className="text-lg font-bold text-[var(--text)]">Word Filter</h2>
          <button
            onClick={onClose}
            aria-label="Close word filter"
            className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-96 overflow-y-auto">
          <p className="text-xs text-[var(--muted)] rounded-lg bg-[var(--panel-2)] px-3 py-2">
            Applies on this device to messages you send — server-wide enforcement is coming.
          </p>

          {/* Enable toggle */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <div id="automod-enable-label" className="text-sm text-[var(--text)] font-medium">Block my messages with these words</div>
              <div className="text-xs text-[var(--muted)]">Stops a message from sending if it contains a blocked word</div>
            </div>
            <button
              onClick={() => setEnabled(!enabled)}
              autoFocus
              role="switch"
              aria-checked={enabled}
              aria-labelledby="automod-enable-label"
              className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${enabled ? "bg-[var(--accent)]" : "bg-[var(--accent-2)]/30"}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${enabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </button>
          </div>

          {/* Blocked words */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-[var(--muted)]">Blocked Words ({words.length})</label>
              <button
                onClick={loadDefaults}
                className="text-[10px] text-[var(--accent-2)] hover:text-[var(--accent)] transition-colors"
              >
                + Add defaults
              </button>
            </div>
            <div className="flex gap-1 mb-2">
              <input
                type="text"
                aria-label="Word to block"
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addWord(); } }}
                placeholder="Add word..."
                className="flex-1 px-3 py-1.5 text-sm bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)] placeholder:text-[var(--muted)]"
              />
              <button
                onClick={addWord}
                disabled={!newWord.trim()}
                className="px-3 py-1.5 bg-[var(--accent-2)] text-[var(--text)] rounded-lg text-sm hover:bg-[var(--accent)] transition-colors disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
              {words.map((word) => (
                <span
                  key={word}
                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--danger)]/20 text-[var(--danger)] text-xs rounded-full"
                >
                  {word}
                  <button
                    onClick={() => removeWord(word)}
                    aria-label={`Remove ${word}`}
                    className="hover:text-[var(--text)] transition-colors"
                  >
                    &times;
                  </button>
                </span>
              ))}
              {words.length === 0 && (
                <span className="text-xs text-[var(--muted)] italic">No blocked words yet</span>
              )}
            </div>
          </div>

          {/* Save */}
          <button
            onClick={save}
            className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded-lg hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors font-medium"
          >
            {saved ? "Saved on this device" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Check if a message you're about to send hits this device's word filter. */
export function checkAutoMod(serverId: string, content: string): { blocked: boolean; action: string; word?: string } {
  if (typeof window === "undefined") return { blocked: false, action: "none" };
  try {
    const saved = localStorage.getItem(`campfire-automod-${serverId}`);
    if (!saved) return { blocked: false, action: "none" };
    const data = JSON.parse(saved);
    if (!data.enabled || !data.words?.length) return { blocked: false, action: "none" };
    const lower = content.toLowerCase();
    for (const word of data.words) {
      if (lower.includes(word)) {
        return { blocked: true, action: "block", word };
      }
    }
  } catch { /* ignore */ }
  return { blocked: false, action: "none" };
}
