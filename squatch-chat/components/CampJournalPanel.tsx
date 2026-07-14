"use client";

import { useEffect, useState } from "react";

interface JournalEntry {
  id: string;
  content: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  note?: string | null;
  createdAt: string;
  sourceMessageId?: string | null;
  sourceMessage?: {
    channelId: string;
    author: { id: string; username: string };
  } | null;
}

export default function CampJournalPanel({
  serverId,
  onClose,
  onJumpToMessage,
}: {
  serverId: string;
  onClose: () => void;
  onJumpToMessage?: (channelId: string, messageId: string) => void;
}) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loadedServerId, setLoadedServerId] = useState<string | null>(null);
  const loading = loadedServerId !== serverId;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/servers/${serverId}/journal`, {
      signal: controller.signal,
    })
      .then(async (response) => ({
        ok: response.ok,
        data: await response.json(),
      }))
      .then(({ ok, data }) => {
        if (!controller.signal.aborted) {
          setEntries(ok ? data.entries ?? [] : []);
        }
      })
      .catch((cause: unknown) => {
        if (
          !controller.signal.aborted
          && (!(cause instanceof Error) || cause.name !== "AbortError")
        ) {
          setEntries([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedServerId(serverId);
      });
    return () => controller.abort();
  }, [serverId]);

  async function remove(entryId: string) {
    const response = await fetch(`/api/servers/${serverId}/journal?entryId=${encodeURIComponent(entryId)}`, {
      method: "DELETE",
    });
    if (response.ok) setEntries((current) => current.filter((entry) => entry.id !== entryId));
  }

  return (
    <aside className="w-80 flex flex-col border-l border-[var(--accent-2)]/30 bg-[var(--panel)] shrink-0" aria-label="Camp Journal">
      <div className="h-12 px-3 flex items-center justify-between border-b border-[var(--accent-2)]/30 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">Camp Journal</h2>
          <p className="text-[10px] text-[var(--muted)]">Private keepsakes from this camp</p>
        </div>
        <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-lg" aria-label="Close Camp Journal">&times;</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <p className="text-xs text-[var(--muted)]">Opening your journal...</p>
        ) : entries.length === 0 ? (
          <div className="text-center text-[var(--muted)] py-8">
            <p className="text-sm font-medium">No keepsakes yet</p>
            <p className="text-xs mt-1">Use a message&apos;s journal action to preserve it - even in leave-no-trace rooms.</p>
          </div>
        ) : entries.map((entry) => (
          <article key={entry.id} className="rounded-lg border border-[var(--accent-2)]/25 bg-[var(--panel-2)] p-3">
            {entry.note && <p className="text-xs text-[var(--accent-2)] mb-2 italic">{entry.note}</p>}
            {entry.content && <p className="text-sm text-[var(--text)] whitespace-pre-wrap break-words">{entry.content}</p>}
            {entry.attachmentUrl && (
              <a className="text-xs text-[var(--accent-2)] hover:underline block mt-2 truncate" href={entry.attachmentUrl} target="_blank" rel="noreferrer">
                {entry.attachmentName || "Saved attachment"}
              </a>
            )}
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[var(--muted)]">
              <span>{new Date(entry.createdAt).toLocaleString()}</span>
              <div className="flex items-center gap-2">
                {entry.sourceMessage && entry.sourceMessageId && onJumpToMessage && (
                  <button
                    className="hover:text-[var(--accent-2)]"
                    onClick={() => onJumpToMessage(entry.sourceMessage!.channelId, entry.sourceMessageId!)}
                  >
                    Jump
                  </button>
                )}
                <button className="hover:text-[var(--danger)]" onClick={() => void remove(entry.id)}>Remove</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}
