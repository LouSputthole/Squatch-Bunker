"use client";

import { useState } from "react";

interface PurgeMessagesModalProps {
  channelId: string;
  channelName: string;
  open: boolean;
  onClose: () => void;
  onPurged?: (messageIds: string[]) => void;
}

export default function PurgeMessagesModal({ channelId, channelName, open, onClose, onPurged }: PurgeMessagesModalProps) {
  const [count, setCount] = useState(10);
  const [userId, setUserId] = useState("");
  const [purging, setPurging] = useState(false);
  const [result, setResult] = useState<{ deleted: number } | null>(null);
  const [error, setError] = useState("");

  async function handlePurge() {
    setPurging(true);
    setError("");
    setResult(null);

    try {
      const body: { channelId: string; count: number; userId?: string } = { channelId, count };
      if (userId.trim()) body.userId = userId.trim();

      const res = await fetch("/api/messages/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data = await res.json();
        setResult({ deleted: data.deleted });
        if (data.messageIds?.length && onPurged) onPurged(data.messageIds);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to purge");
      }
    } catch {
      setError("Network error");
    }
    setPurging(false);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-sm bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--accent-2)]/20">
          <div>
            <h2 className="text-lg font-bold text-[var(--danger)]">Purge Messages</h2>
            <p className="text-xs text-[var(--muted)]">#{channelName}</p>
          </div>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-[var(--muted)]">
            Delete the most recent messages from this channel. This action cannot be undone.
          </p>

          <div>
            <label className="text-xs text-[var(--muted)] block mb-1">Number of messages (1-100)</label>
            <input
              type="number"
              min={1}
              max={100}
              value={count}
              onChange={(e) => setCount(Math.min(100, Math.max(1, parseInt(e.target.value) || 1)))}
              className="w-full px-3 py-2 text-sm bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)]"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--muted)] block mb-1">Filter by user ID (optional)</label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Leave blank for all users"
              className="w-full px-3 py-2 text-sm bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)] placeholder:text-[var(--muted)]"
            />
          </div>

          {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
          {result && <p className="text-xs text-green-400">Deleted {result.deleted} messages</p>}

          <button
            onClick={handlePurge}
            disabled={purging}
            className="w-full py-2.5 bg-[var(--danger)] text-white rounded-lg hover:opacity-90 transition-opacity font-medium disabled:opacity-50"
          >
            {purging ? "Purging..." : `Purge ${count} Messages`}
          </button>
        </div>
      </div>
    </div>
  );
}
