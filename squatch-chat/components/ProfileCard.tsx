"use client";

import { useEffect, useRef } from "react";
import Avatar from "@/components/Avatar";
import { displayName } from "@/lib/utils";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  mod: "Mod",
};

const ROLE_COLORS: Record<string, string> = {
  owner: "#f59e0b",
  admin: "#ef4444",
  mod: "#3b82f6",
};

export interface ProfileCardProps {
  username: string;
  avatar?: string | null;
  role?: string;
  joinedAt?: string;
  anchorX: number;
  anchorY: number;
  onClose: () => void;
}

export default function ProfileCard({ username, avatar, role, joinedAt, anchorX, anchorY, onClose }: ProfileCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const cardWidth = 224;
  const margin = 8;
  let left = anchorX + margin;
  let top = anchorY;

  if (typeof window !== "undefined") {
    if (left + cardWidth > window.innerWidth - margin) left = anchorX - cardWidth - margin;
    if (top + 160 > window.innerHeight - margin) top = window.innerHeight - 168;
  }

  const roleLabel = role ? ROLE_LABELS[role] : null;
  const roleColor = role ? ROLE_COLORS[role] : null;
  const joinDate = joinedAt
    ? new Date(joinedAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : null;

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-xl shadow-2xl p-4"
      style={{ left, top, width: cardWidth }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3">
        <Avatar
          username={username}
          avatarUrl={avatar}
          size={48}
          className="bg-[var(--accent-2)] text-[var(--text)] shrink-0"
        />
        <div className="min-w-0">
          <p className="font-semibold text-sm text-[var(--text)] truncate" title={displayName(username)}>
            {displayName(username)}
          </p>
          <p className="text-xs text-[var(--muted)] truncate">{username}</p>
          {roleLabel && (
            <span
              className="inline-block mt-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded"
              style={{ color: roleColor ?? undefined, backgroundColor: roleColor ? `${roleColor}20` : undefined }}
            >
              {roleLabel}
            </span>
          )}
        </div>
      </div>
      {joinDate && (
        <div className="mt-3 pt-3 border-t border-[var(--accent-2)]/20">
          <p className="text-xs text-[var(--muted)]">
            <span className="font-medium text-[var(--text)]">Joined</span> {joinDate}
          </p>
        </div>
      )}
    </div>
  );
}
