"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface MessageContextMenuProps {
  x: number;
  y: number;
  message: {
    id: string;
    content: string;
    author: { id: string; username: string };
    pinned?: boolean;
  };
  currentUserId: string;
  canPin?: boolean;
  onReply: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onPin: (pinned: boolean) => void;
  onReact: (emoji: string) => void;
  onCopyText: () => void;
  onBookmark: () => void;
  onClose: () => void;
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "🔥", "👀"];

const ITEM_CLASS =
  "px-3 py-1.5 text-sm text-[var(--text)] hover:bg-[var(--accent-2)]/20 cursor-pointer flex items-center gap-2 w-full text-left outline-none focus:bg-[var(--accent-2)]/20";

export default function MessageContextMenu({
  x,
  y,
  message,
  currentUserId,
  canPin,
  onReply,
  onEdit,
  onDelete,
  onPin,
  onReact,
  onCopyText,
  onBookmark,
  onClose,
}: MessageContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [showEmojiRow, setShowEmojiRow] = useState(false);
  const [focusIdx, setFocusIdx] = useState(0);

  const isOwn = message.author.id === currentUserId;

  const buildItems = useCallback(() => {
    const items: string[] = ["reply", "react"];
    if (isOwn && onEdit) items.push("edit");
    items.push("copytext", "bookmark");
    if (canPin) items.push("pin");
    if (isOwn && onDelete) items.push("delete");
    return items;
  }, [isOwn, canPin, onEdit, onDelete]);

  // Flip position to avoid viewport overflow
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let nx = x;
    let ny = y;
    if (x + rect.width > vw) nx = Math.max(0, x - rect.width);
    if (y + rect.height > vh) ny = Math.max(0, y - rect.height);
    setPos({ x: nx, y: ny });
  }, [x, y]);

  // Close on outside click or Escape; arrow key navigation
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const items = buildItems();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusIdx((prev) => (prev + 1) % items.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((prev) => (prev - 1 + items.length) % items.length);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        menuRef.current?.querySelector<HTMLElement>(`[data-item-idx="${focusIdx}"]`)?.click();
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, buildItems, focusIdx]);

  // Focus the active item when focusIdx changes
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>(`[data-item-idx="${focusIdx}"]`)?.focus();
  }, [focusIdx]);

  // Focus first item on mount
  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>(`[data-item-idx="0"]`)?.focus();
  }, []);

  function wrap(fn: () => void) {
    return () => { fn(); onClose(); };
  }

  const items = buildItems();

  function itemProps(key: string) {
    const idx = items.indexOf(key);
    return {
      "data-item-idx": idx,
      tabIndex: idx === focusIdx ? 0 : -1,
      role: "menuitem" as const,
      onFocus: () => setFocusIdx(idx),
    };
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Message actions"
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex: 9999 }}
      className="bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-2xl py-1 min-w-[160px]"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 1. Reply */}
      <button className={ITEM_CLASS} onClick={wrap(onReply)} {...itemProps("reply")}>
        <span>↩</span>
        <span>Reply</span>
      </button>

      {/* 2. React */}
      <button
        className={ITEM_CLASS}
        onClick={() => setShowEmojiRow((v) => !v)}
        {...itemProps("react")}
      >
        <span>😀</span>
        <span>React</span>
      </button>
      {showEmojiRow && (
        <div className="flex gap-0.5 px-2 py-1 flex-wrap">
          {QUICK_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              className="text-lg p-1 rounded hover:bg-[var(--panel-2)] transition-colors leading-none"
              title={emoji}
              role="menuitem"
              onClick={wrap(() => onReact(emoji))}
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* 3. Edit — only if own message */}
      {isOwn && onEdit && (
        <button className={ITEM_CLASS} onClick={wrap(onEdit)} {...itemProps("edit")}>
          <span>✏️</span>
          <span>Edit</span>
        </button>
      )}

      <hr className="border-[var(--accent-2)]/20 my-1" />

      {/* 5. Copy Text */}
      <button className={ITEM_CLASS} onClick={wrap(onCopyText)} {...itemProps("copytext")}>
        <span>📋</span>
        <span>Copy Text</span>
      </button>

      {/* 6. Bookmark */}
      <button className={ITEM_CLASS} onClick={wrap(onBookmark)} {...itemProps("bookmark")}>
        <span>★</span>
        <span>Bookmark</span>
      </button>

      {/* 7. Pin/Unpin — only if canPin */}
      {canPin && (
        <button
          className={ITEM_CLASS}
          onClick={wrap(() => onPin(!message.pinned))}
          {...itemProps("pin")}
        >
          <span>📌</span>
          <span>{message.pinned ? "Unpin" : "Pin"}</span>
        </button>
      )}

      <hr className="border-[var(--accent-2)]/20 my-1" />

      {/* 9. Delete — only if own message, danger color */}
      {isOwn && onDelete && (
        <button
          className="px-3 py-1.5 text-sm text-[var(--danger)] hover:bg-[var(--accent-2)]/20 cursor-pointer flex items-center gap-2 w-full text-left outline-none focus:bg-[var(--accent-2)]/20"
          onClick={wrap(onDelete)}
          {...itemProps("delete")}
        >
          <span>🗑️</span>
          <span>Delete</span>
        </button>
      )}
    </div>
  );
}
