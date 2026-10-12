"use client";

import { useEffect, useState } from "react";
import { downloadText } from "@/lib/download";
import { journalMarkdown } from "@/lib/journal";
import { toast, toastResponseError } from "@/lib/toast";

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
  const [reloadCount, setReloadCount] = useState(0);
  const loadKey = `${serverId}:${reloadCount}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const loading = loadedKey !== loadKey;

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/servers/${serverId}/journal`, {
      signal: controller.signal,
    })
      .then(async (response) => ({
        ok: response.ok,
        data: await response.json().catch(() => ({})),
      }))
      .then(({ ok, data }) => {
        if (!controller.signal.aborted) {
          setEntries(ok ? data.entries ?? [] : []);
          setLoadError(!ok);
        }
      })
      .catch((cause: unknown) => {
        if (
          !controller.signal.aborted
          && (!(cause instanceof Error) || cause.name !== "AbortError")
        ) {
          setEntries([]);
          setLoadError(true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadedKey(`${serverId}:${reloadCount}`);
      });
    return () => controller.abort();
  }, [serverId, reloadCount]);

  async function remove(entryId: string) {
    try {
      const response = await fetch(`/api/servers/${serverId}/journal?entryId=${encodeURIComponent(entryId)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        await toastResponseError(response, "Couldn't remove that keepsake");
        return;
      }
      setEntries((current) => current.filter((entry) => entry.id !== entryId));
    } catch {
      toast("Couldn't remove that keepsake", "error");
    }
  }

  return (
    <aside className="w-80 flex flex-col border-l border-[var(--accent-2)]/30 bg-[var(--panel)] shrink-0" aria-label="Camp Journal">
      <div className="h-12 px-3 flex items-center justify-between border-b border-[var(--accent-2)]/30 shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text)]">Camp Journal</h2>
          <p className="text-[10px] text-[var(--muted)]">Private keepsakes from this camp</p>
        </div>
        <div className="flex items-center gap-3">
          {entries.length > 0 && (
            <button
              onClick={() => downloadText("camp-journal.md", "text/markdown", journalMarkdown(entries))}
              className="text-xs text-[var(--muted)] hover:text-[var(--text)]"
            >
              Export
            </button>
          )}
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-lg" aria-label="Close Camp Journal">&times;</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading ? (
          <p className="text-xs text-[var(--muted)]">Opening your journal...</p>
        ) : loadError ? (
          <div className="text-center text-[var(--muted)] py-8" role="alert">
            <p className="text-sm font-medium">Couldn&apos;t open your journal</p>
            <button
              onClick={() => setReloadCount((count) => count + 1)}
              className="mt-2 rounded-lg bg-[var(--panel-2)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--accent-2)]/30"
            >
              Try again
            </button>
          </div>
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
                    className="hover:text-[var(--accent)]"
                    onClick={() => onJumpToMessage(entry.sourceMessage!.channelId, entry.sourceMessageId!)}
                    aria-label="Jump to original message"
                  >
                    Jump
                  </button>
                )}
                <button className="hover:text-[var(--danger)]" onClick={() => void remove(entry.id)} aria-label="Remove keepsake">Remove</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </aside>
  );
}
