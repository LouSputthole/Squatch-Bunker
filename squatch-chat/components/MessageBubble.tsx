"use client";

import { useState } from "react";

interface MessageBubbleProps {
  message: {
    id: string;
    content: string;
    createdAt: string;
    updatedAt?: string;
    author: { id: string; username: string };
  };
  isOwn: boolean;
  onEdit?: (messageId: string, newContent: string) => void;
  onDelete?: (messageId: string) => void;
}

export default function MessageBubble({ message, isOwn, onEdit, onDelete }: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [showActions, setShowActions] = useState(false);

  const displayUsername =
    message.author.username.length > 20
      ? `${message.author.username.slice(0, 20)}…`
      : message.author.username;

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const wasEdited = message.updatedAt && message.updatedAt !== message.createdAt;

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editContent.trim() || editContent.trim() === message.content) {
      setEditing(false);
      setEditContent(message.content);
      return;
    }
    onEdit?.(message.id, editContent.trim());
    setEditing(false);
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setEditing(false);
      setEditContent(message.content);
    }
  }

  return (
    <div
      className="flex gap-3 py-1 group hover:bg-[var(--panel)]/30 px-1 rounded relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div className="w-10 h-10 rounded-full bg-[var(--accent-2)] flex items-center justify-center text-sm font-bold text-[var(--text)] shrink-0 mt-0.5">
        {message.author.username.slice(0, 2).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`font-semibold text-sm ${isOwn ? "text-[var(--accent)]" : "text-[var(--text)]"}`}>
            <span title={message.author.username}>{displayUsername}</span>
          </span>
          <span className="text-xs text-[var(--muted)]">{time}</span>
          {wasEdited && <span className="text-xs text-[var(--muted)] italic">(edited)</span>}
        </div>

        {editing ? (
          <form onSubmit={handleEditSubmit} className="mt-1">
            <input
              type="text"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onKeyDown={handleEditKeyDown}
              className="w-full px-2 py-1 bg-[var(--panel)] text-[var(--text)] border border-[var(--accent-2)] rounded text-sm focus:outline-none"
              autoFocus
            />
            <div className="flex gap-2 mt-1 text-xs text-[var(--muted)]">
              <span>Esc to cancel</span>
              <span>Enter to save</span>
            </div>
          </form>
        ) : (
          <p className="text-[var(--text)] text-sm break-words">{message.content}</p>
        )}
      </div>

      {/* Action buttons — show on hover */}
      {showActions && !editing && isOwn && (
        <div className="absolute right-1 top-0 flex gap-1 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded px-1 py-0.5 shadow-lg">
          <button
            onClick={() => { setEditing(true); setEditContent(message.content); }}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-1.5 py-0.5"
            title="Edit"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete?.(message.id)}
            className="text-xs text-[var(--muted)] hover:text-[var(--danger)] px-1.5 py-0.5"
            title="Delete"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
