"use client";

import { useState, useEffect } from "react";
import Avatar from "./Avatar";

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
}: PinnedMessagesPanelProps) {
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/messages?channelId=${channelId}&pinned=true`)
      .then((res) => res.json())
      .then((data) => {
        setPinnedMessages(data.messages || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [channelId]);

  function handleUnpin(messageId: string) {
    onUnpin(messageId);
    setPinnedMessages((prev) => prev.filter((m) => m.id !== messageId));
  }

  const count = pinnedMessages.length;

  return (
    <div
      className="w-64 shrink-0 flex flex-col border-l border-[var(--accent-2)]/30 bg-[var(--panel)]"
      style={{ height: "100%" }}
    >
      {/* Header */}
      <div className="h-12 px-3 flex items-center justify-between border-b border-[var(--accent-2)]/30 shrink-0">
        <span className="text-sm font-semibold text-[var(--text)]">
          {loading ? "📌 Pinned Messages" : count > 0 ? `📌 Pinned (${count})` : "📌 Pinned Messages"}
        </span>
        <button
          onClick={onClose}
          className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
          title="Close pinned panel"
        >
          &times;
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="px-4 py-6 text-sm text-[var(--muted)] italic">Loading...</div>
        ) : count === 0 ? (
          <div className="flex flex-col items-center justify-center h-full py-10 gap-2 text-[var(--muted)]">
            <span className="text-3xl">📌</span>
            <span className="text-sm text-center px-4">No pinned messages yet</span>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--accent-2)]/10">
            {pinnedMessages.map((msg) => {
              const preview = msg.content
                ? msg.content.length > 150
                  ? msg.content.slice(0, 150) + "..."
                  : msg.content
                : msg.attachmentName
                  ? `[${msg.attachmentName}]`
                  : "[attachment]";

              return (
                <li
                  key={msg.id}
                  className="px-3 py-2.5 hover:bg-[var(--panel-2)]/50 transition-colors"
                >
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
                      onClick={() => onJumpToMessage(msg.id)}
                      className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent-2)]/15 text-[var(--accent-2)] hover:bg-[var(--accent-2)]/30 transition-colors"
                    >
                      Jump to
                    </button>
                    {canPin && (
                      <button
                        onClick={() => handleUnpin(msg.id)}
                        className="text-[10px] px-2 py-0.5 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/25 transition-colors"
                      >
                        Unpin
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
