"use client";

import { useState } from "react";
import { displayName, truncateName } from "@/lib/utils";
import Avatar from "@/components/Avatar";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🔥", "👀", "🎉"];

// URL regex — matches http(s) links
const URL_REGEX = /https?:\/\/[^\s<]+[^\s<.,;:!?'")\]]/g;
// Mention regex — matches @username
const MENTION_REGEX = /@(\w+(?:#[a-f0-9]+)?)/g;

function renderContent(text: string) {
  // Split text into segments: plain text, URLs, mentions
  const parts: { type: "text" | "url" | "mention"; value: string }[] = [];
  const combined = new RegExp(`(${URL_REGEX.source})|(${MENTION_REGEX.source})`, "g");
  let lastIndex = 0;
  let match;

  while ((match = combined.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    if (match[1]) {
      parts.push({ type: "url", value: match[1] });
    } else if (match[3]) {
      parts.push({ type: "mention", value: match[3] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: "text", value: text.slice(lastIndex) });
  }

  if (parts.length === 0) return text;

  return parts.map((part, i) => {
    if (part.type === "url") {
      return (
        <a
          key={i}
          href={part.value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:underline break-all"
        >
          {part.value}
        </a>
      );
    }
    if (part.type === "mention") {
      return (
        <span key={i} className="bg-blue-500/20 text-blue-300 rounded px-1 font-medium">
          @{part.value}
        </span>
      );
    }
    return <span key={i}>{part.value}</span>;
  });
}

interface ReactionGroup {
  count: number;
  users: string[];
  userIds: string[];
}

interface MessageBubbleProps {
  message: {
    id: string;
    content: string;
    attachmentUrl?: string | null;
    attachmentName?: string | null;
    pinned?: boolean;
    createdAt: string;
    updatedAt?: string;
    author: { id: string; username: string; avatar?: string | null };
    reactions?: Record<string, ReactionGroup>;
  };
  isOwn: boolean;
  currentUserId?: string;
  canPin?: boolean;
  onEdit?: (messageId: string, newContent: string) => void;
  onDelete?: (messageId: string) => void;
  onReact?: (messageId: string, emoji: string) => void;
  onPin?: (messageId: string, pinned: boolean) => void;
}

export default function MessageBubble({ message, isOwn, currentUserId, canPin, onEdit, onDelete, onReact, onPin }: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [showActions, setShowActions] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const shown = truncateName(message.author.username, 20);

  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const wasEdited = message.updatedAt && message.updatedAt !== message.createdAt;
  const reactions = message.reactions || {};
  const reactionEntries = Object.entries(reactions);

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

  function handleReact(emoji: string) {
    onReact?.(message.id, emoji);
    setShowEmojiPicker(false);
  }

  return (
    <div
      className="flex gap-3 py-1 group hover:bg-[var(--panel)]/30 px-1 rounded relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); setShowEmojiPicker(false); }}
    >
      <Avatar
        username={message.author.username}
        avatarUrl={message.author.avatar}
        size={40}
        className="bg-[var(--accent-2)] text-[var(--text)] mt-0.5"
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`font-semibold text-sm ${isOwn ? "text-[var(--accent)]" : "text-[var(--text)]"}`}>
            <span title={displayName(message.author.username)}>{shown}</span>
          </span>
          <span className="group/ts relative cursor-default">
            <span className="text-xs text-[var(--muted)]">{time}</span>
            <span className="absolute bottom-full left-0 mb-1 px-2 py-1 text-xs bg-black/90 text-white rounded whitespace-nowrap opacity-0 group-hover/ts:opacity-100 transition-opacity pointer-events-none z-10">
              {new Date(message.createdAt).toLocaleString()}
              {wasEdited && ` (edited at ${new Date(message.updatedAt!).toLocaleString()})`}
            </span>
          </span>
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
          <>
            {message.content && (
              <p className="text-[var(--text)] text-sm break-words">{renderContent(message.content)}</p>
            )}
            {message.attachmentUrl && (
              <Attachment url={message.attachmentUrl} name={message.attachmentName} />
            )}
          </>
        )}

        {/* Reaction badges */}
        {reactionEntries.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {reactionEntries.map(([emoji, data]) => {
              const iMine = currentUserId ? data.userIds.includes(currentUserId) : false;
              return (
                <button
                  key={emoji}
                  onClick={() => handleReact(emoji)}
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                    iMine
                      ? "bg-[var(--accent)]/20 border border-[var(--accent)]/50 text-[var(--text)]"
                      : "bg-[var(--panel-2)] border border-[var(--accent-2)]/30 text-[var(--muted)] hover:border-[var(--accent-2)]"
                  }`}
                  title={data.users.map((u) => displayName(u)).join(", ")}
                >
                  <span>{emoji}</span>
                  <span className="font-medium">{data.count}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pinned indicator */}
      {message.pinned && (
        <div className="absolute left-1 top-0 text-yellow-400 text-xs px-1 py-0.5 opacity-70" title="Pinned message">📌</div>
      )}

      {/* Action buttons — show on hover */}
      {showActions && !editing && (
        <div className="absolute right-1 top-0 flex gap-0.5 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded px-0.5 py-0.5 shadow-lg z-10">
          <button
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="text-xs text-[var(--muted)] hover:text-[var(--text)] px-1.5 py-0.5"
            title="React"
          >
            😀
          </button>
          {canPin && (
            <button
              onClick={() => onPin?.(message.id, !message.pinned)}
              className={`text-xs px-1.5 py-0.5 ${message.pinned ? "text-yellow-400 hover:text-[var(--muted)]" : "text-[var(--muted)] hover:text-yellow-400"}`}
              title={message.pinned ? "Unpin" : "Pin"}
            >
              📌
            </button>
          )}
          {isOwn && (
            <>
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
            </>
          )}
        </div>
      )}

      {/* Quick emoji picker */}
      {showEmojiPicker && (
        <div className="absolute right-1 top-7 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg px-2 py-1.5 shadow-xl z-20 flex gap-1">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              onClick={() => handleReact(emoji)}
              className="text-lg hover:scale-125 transition-transform px-0.5"
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Attachment({ url, name }: { url: string; name?: string | null }) {
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(url);
  const displayName = name || url.split("/").pop() || "file";

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block mt-1">
        <img
          src={url}
          alt={displayName}
          className="max-w-xs max-h-64 rounded-lg border border-[var(--accent-2)]/30 object-cover hover:opacity-90 transition-opacity"
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      download={displayName}
      className="mt-1 inline-flex items-center gap-2 px-3 py-2 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg text-sm text-[var(--text)] hover:border-[var(--accent-2)] transition-colors"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--muted)]">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      <span className="truncate max-w-[200px]">{displayName}</span>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--muted)]">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
      </svg>
    </a>
  );
}
