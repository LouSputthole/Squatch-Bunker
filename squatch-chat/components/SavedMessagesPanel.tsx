"use client";

import { useEffect, useState } from "react";
import Avatar from "./Avatar";
import BlockedMessageGate from "./BlockedMessageGate";
import ChatIcon from "./ChatIcons";
import { displayName } from "@/lib/utils";

interface SavedBookmark {
  id: string;
  messageId: string;
  createdAt: string;
  message: {
    id: string;
    channelId: string;
    content: string;
    attachmentName?: string | null;
    createdAt: string;
    author: { id: string; username: string; avatar?: string | null };
  } | null;
}

interface SavedMessagesPanelProps {
  currentChannelId: string;
  /** Live bookmark set from ChatPanel — removals elsewhere hide here at once, additions refetch. */
  bookmarkedMessageIds: ReadonlySet<string>;
  onClose: () => void;
  onJumpToMessage: (channelId: string, messageId: string) => void;
  /** Removes the bookmark; resolves false when the server refused. */
  onRemove: (messageId: string) => Promise<boolean>;
  blockedUserIds?: ReadonlySet<string>;
}

function formatSavedTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString([], { month: "short", day: "numeric" }) +
    " " + date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Side panel listing the viewer's saved (bookmarked) messages across channels. */
export default function SavedMessagesPanel({
  currentChannelId,
  bookmarkedMessageIds,
  onClose,
  onJumpToMessage,
  onRemove,
  blockedUserIds,
}: SavedMessagesPanelProps) {
  const [items, setItems] = useState<SavedBookmark[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const savedCount = bookmarkedMessageIds.size;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/bookmarks", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load saved messages");
        return res.json();
      })
      .then((data: { bookmarks?: SavedBookmark[] }) => {
        setItems((data.bookmarks ?? []).filter((bookmark) => bookmark.message));
        setFailed(false);
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
        setLoaded(true);
      });
    return () => controller.abort();
    // savedCount: refetch when something is saved while the panel is open.
  }, [reloadCount, savedCount]);

  async function remove(messageId: string) {
    setRemoving(messageId);
    try {
      if (await onRemove(messageId)) {
        setItems((current) => current.filter((item) => item.messageId !== messageId));
      }
    } finally {
      setRemoving(null);
    }
  }

  const visible = items.filter((item) => bookmarkedMessageIds.has(item.messageId));

  return (
    <aside
      aria-label="Saved messages"
      className="w-72 shrink-0 flex flex-col border-l border-[var(--accent-2)]/30 bg-[var(--panel)]"
    >
      <div className="h-12 px-3 flex items-center justify-between border-b border-[var(--accent-2)]/30 shrink-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <ChatIcon name="bookmark" size={16} className="text-[var(--muted)]" />
          Saved{visible.length > 0 ? ` (${visible.length})` : ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
          aria-label="Close saved messages"
          title="Close"
        >
          <ChatIcon name="close" size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!loaded ? (
          <div className="px-4 py-6 text-sm text-[var(--muted)] italic">Loading...</div>
        ) : failed && visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-[var(--muted)]">
            <p>Couldn&apos;t load your saved messages.</p>
            <button
              type="button"
              onClick={() => setReloadCount((count) => count + 1)}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] hover:bg-[var(--accent-2)] hover:text-[var(--text)]"
            >
              Try again
            </button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center text-[var(--muted)]">
            <ChatIcon name="bookmark" size={28} />
            <p className="text-sm">Nothing saved yet</p>
            <p className="text-xs">Hover a message and press the bookmark button to keep it here.</p>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--accent-2)]/10">
            {visible.map((item) => {
              const message = item.message!;
              const blocked = blockedUserIds?.has(message.author.id) ?? false;
              const inThisChannel = message.channelId === currentChannelId;
              const preview = message.content
                ? message.content.length > 160
                  ? message.content.slice(0, 160) + "…"
                  : message.content
                : message.attachmentName
                  ? `[${message.attachmentName}]`
                  : "[attachment]";
              return (
                <li key={`${item.id}:${blocked ? "blocked" : "visible"}`} className="px-3 py-2.5 transition-colors hover:bg-[var(--panel-2)]/50">
                  <BlockedMessageGate blocked={blocked} className="py-1">
                    <div className="mb-1 flex items-center gap-1.5">
                      <Avatar username={message.author.username} avatarUrl={message.author.avatar} size={20} />
                      <span className="truncate text-xs font-semibold text-[var(--accent-2)]">
                        {displayName(message.author.username)}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-[var(--muted)]">{formatSavedTime(message.createdAt)}</span>
                    </div>
                    <p className="mb-2 break-words text-xs leading-relaxed text-[var(--text)]">{preview}</p>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onJumpToMessage(message.channelId, message.id)}
                        className="rounded bg-[var(--accent-2)]/15 px-2 py-0.5 text-[10px] text-[var(--accent-2)] transition-colors hover:bg-[var(--accent-2)]/30"
                      >
                        {inThisChannel ? "Jump to" : "Open channel"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(message.id)}
                        disabled={removing === message.id}
                        className="rounded bg-[var(--danger)]/10 px-2 py-0.5 text-[10px] text-[var(--danger)] transition-colors hover:bg-[var(--danger)]/25 disabled:opacity-50"
                      >
                        Remove
                      </button>
                      {!inThisChannel && <span className="ml-auto text-[10px] text-[var(--muted)]">Other channel</span>}
                    </div>
                  </BlockedMessageGate>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
