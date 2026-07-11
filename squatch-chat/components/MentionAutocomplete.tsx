"use client";

import { useState, useEffect, useMemo } from "react";

interface MentionUser {
  id: string;
  username: string;
  avatar?: string | null;
}

interface MentionAutocompleteProps {
  query: string;
  members: MentionUser[];
  onSelect: (user: MentionUser) => void;
  onClose: () => void;
}

export default function MentionAutocomplete({ query, members, onSelect, onClose }: MentionAutocompleteProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return members.filter((m) => m.username.toLowerCase().includes(q)).slice(0, 8);
  }, [query, members]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((prev) => (prev + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Tab" || e.key === "Enter") {
        if (filtered.length > 0) {
          e.preventDefault();
          onSelect(filtered[selectedIdx]);
          onClose();
        }
      } else if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [filtered, selectedIdx, onSelect, onClose]);

  if (filtered.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 mb-1 w-64 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl py-1 z-50">
      <div className="px-3 py-1 text-[10px] text-[var(--muted)] uppercase font-semibold">Members</div>
      {filtered.map((user, idx) => (
        <button
          key={user.id}
          onClick={() => { onSelect(user); onClose(); }}
          className={`w-full px-3 py-1.5 text-left flex items-center gap-2 transition-colors text-sm ${
            idx === selectedIdx ? "bg-[var(--accent-2)]/20 text-[var(--text)]" : "text-[var(--muted)] hover:bg-[var(--accent-2)]/10"
          }`}
        >
          {user.avatar ? (
            <img src={user.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
          ) : (
            <div className="w-5 h-5 rounded-full bg-[var(--accent-2)] flex items-center justify-center text-[10px] font-bold text-[var(--text)]">
              {user.username.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="font-medium">@{user.username}</span>
        </button>
      ))}
    </div>
  );
}
