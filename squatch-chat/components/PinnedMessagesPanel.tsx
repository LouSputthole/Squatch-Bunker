"use client";

import { useState, useEffect } from "react";
import Avatar from "./Avatar";
import BlockedMessageGate from "./BlockedMessageGate";
import ChatIcon from "./ChatIcons";

interface PinnedMessage {
  id: string;
  content: string;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  createdAt: string;
  author: { id: string; username: string; avatar?: string | null };
}

interface PinnedMessagesPanelProps {
  channelId: string;
  canPin: boolean;
  onClose: () => void;
  onJumpToMessage: (messageId: string) => void;
  onUnpin: (messageId: string) => void;
  blockedUserIds?: ReadonlySet<string>;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays === 1) {
    return "Yesterday " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" }) + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } else {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
}

export default function PinnedMessagesPanel({
  channelId,
  canPin,
  onClose,
  onJumpToMessage,
  onUnpin,
  blockedUserIds,
}: PinnedMessagesPanelProps) {
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/messages?channelId=${encodeURIComponent(channelId)}&pinned=true`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load pinned messages");
        return res.json();
      })
      .then((data) => {
        setPinnedMessages(data.messages || []);
        setFailed(false);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
        setLoading(false);
      });
    return () => controller.abort();
  }, [channelId, reloadCount]);

  function handleUnpin(messageId: string) {
    onUnpin(messageId);
    setPinnedMessages((prev) => prev.filter((m) => m.id !== messageId));
  }

  const count = pinnedMessages.length;

  return (
    <aside
      aria-label="Pinned messages"
      className="w-72 shrink-0 flex flex-col border-l border-[var(--accent-2)]/30 bg-[var(--panel)]"
      style={{ height: "100%" }}
    >
      {/* Header */}
      <div className="h-12 px-3 flex items-center justify-between border-b border-[var(--accent-2)]/30 shrink-0">
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <ChatIcon name="pin" size={16} className="text-[var(--muted)]" />
          {!loading && count > 0 ? `Pinned (${count})` : "Pinned Messages"}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
          title="Close pinned messages"
          aria-label="Close pinned messages"
        >
          <ChatIcon name="close" size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-4 py-6 text-sm text-[var(--muted)] italic">Loading...</div>
        ) : failed ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-sm text-[var(--muted)]">
            <p>Couldn&apos;t load pinned messages.</p>
            <button
              type="button"
              onClick={() => { setLoading(true); setReloadCount((n) => n + 1); }}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-[var(--bg)] hover:bg-[var(--accent-2)] hover:text-[var(--text)]"
            >
              Try again
            </button>
          </div>
        ) : count === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-10 gap-2 text-[var(--muted)]">
            <ChatIcon name="pin" size={28} />
            <span className="text-sm text-center px-4">No pinned messages yet</span>
            {canPin && <span className="text-xs text-center px-6">Pin important messages from their ⋯ menu.</span>}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--accent-2)]/10">
            {pinnedMessages.map((msg) => {
              const blocked = blockedUserIds?.has(msg.author.id) ?? false;
              const preview = msg.content
                ? msg.content.length > 150
                  ? msg.content.slice(0, 150) + "..."
                  : msg.content
                : msg.attachmentName
                  ? `[${msg.attachmentName}]`
                  : "[attachment]";

              return (
                <li
                  key={`${msg.id}:${blocked ? "blocked" : "visible"}`}
                  className="px-3 py-2.5 hover:bg-[var(--panel-2)]/50 transition-colors"
                >
                  <BlockedMessageGate blocked={blocked} className="py-1">
                  {/* Author row */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <Avatar
                      username={msg.author.username}
                      avatarUrl={msg.author.avatar}
                      size={20}
                    />
                    <span className="text-xs font-semibold text-[var(--accent-2)] truncate">
                      {msg.author.username}
                    </span>
                    <span className="text-[10px] text-[var(--muted)] ml-auto shrink-0">
                      {formatTime(msg.createdAt)}
                    </span>
                  </div>

                  {/* Content preview */}
                  <p className="text-xs text-[var(--text)] break-words mb-2 leading-relaxed">
                    {preview}
                  </p>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onJumpToMessage(msg.id)}
                      className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-2)]/15 text-[var(--accent-2)] hover:bg-[var(--accent-2)]/30 transition-colors"
                    >
                      Jump to
                    </button>
                    {canPin && (
                      <button
                        type="button"
                        onClick={() => handleUnpin(msg.id)}
                        className="text-[10px] px-2 py-0.5 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/25 transition-colors"
                      >
                        Unpin
                      </button>
                    )}
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
