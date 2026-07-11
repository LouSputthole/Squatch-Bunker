"use client";

import { useState, useEffect } from "react";

interface AutoModSettingsProps {
  serverId: string;
  open: boolean;
  onClose: () => void;
}

const DEFAULT_WORDS = [
  "spam", "scam", "phishing", "malware",
];

export default function AutoModSettings({ serverId, open, onClose }: AutoModSettingsProps) {
  const [enabled, setEnabled] = useState(false);
  const [words, setWords] = useState<string[]>([]);
  const [newWord, setNewWord] = useState("");
  const [action, setAction] = useState<"delete" | "warn" | "mute">("delete");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Load from localStorage (per-server)
    const key = `campfire-automod-${serverId}`;
    try {
      const saved = localStorage.getItem(key);
      if (saved) {
        const data = JSON.parse(saved);
        setEnabled(data.enabled ?? false);
        setWords(data.words ?? []);
        setAction(data.action ?? "delete");
      }
    } catch { /* ignore */ }
  }, [open, serverId]);

  function save() {
    setSaving(true);
    const key = `campfire-automod-${serverId}`;
    localStorage.setItem(key, JSON.stringify({ enabled, words, action }));
    setSaving(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--accent-2)]/20">
          <h2 className="text-lg font-bold text-[var(--text)]">Auto-Moderation</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4 max-h-96 overflow-y-auto">
          {/* Enable toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-[var(--text)] font-medium">Enable Auto-Mod</div>
              <div className="text-xs text-[var(--muted)]">Automatically filter messages containing blocked words</div>
            </div>
            <button
              onClick={() => setEnabled(!enabled)}
              className={`w-11 h-6 rounded-full transition-colors relative ${enabled ? "bg-green-500" : "bg-[var(--accent-2)]/30"}`}
            >
              <div className={`w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform ${enabled ? "translate-x-[22px]" : "translate-x-0.5"}`} />
            </button>
          </div>

          {/* Action */}
          <div>
            <label className="text-xs text-[var(--muted)] mb-1.5 block">Action on Match</label>
            <div className="flex gap-2">
              {(["delete", "warn", "mute"] as const).map((a) => (
                <button
                  key={a}
                  onClick={() => setAction(a)}
                  className={`flex-1 py-1.5 text-xs rounded-lg font-medium capitalize transition-colors ${
                    action === a
                      ? "bg-[var(--accent-2)] text-[var(--text)]"
                      : "bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
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
                    className="hover:text-red-300 transition-colors"
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
            disabled={saving}
            className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded-lg hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors font-medium disabled:opacity-50"
          >
            {saved ? "Saved!" : saving ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Check if a message should be filtered */
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
        return { blocked: true, action: data.action || "delete", word };
      }
    }
  } catch { /* ignore */ }
  return { blocked: false, action: "none" };
}
