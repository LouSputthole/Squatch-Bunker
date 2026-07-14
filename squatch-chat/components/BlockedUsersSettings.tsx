"use client";

import { useEffect, useState } from "react";
import Avatar from "@/components/Avatar";
import { displayName } from "@/lib/utils";

interface BlockedUserEntry {
  id: string;
  createdAt: string;
  user: {
    id: string;
    username: string;
    avatar?: string | null;
  };
}

interface BlockedUsersSettingsProps {
  onBlockChange?: (userId: string, blocked: boolean) => void;
}

export function BlockedUsersSettings({ onBlockChange }: BlockedUsersSettingsProps) {
  const [blocks, setBlocks] = useState<BlockedUserEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/blocks")
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load blocked users.");
        return response.json() as Promise<{ blocks?: BlockedUserEntry[] }>;
      })
      .then((data) => {
        if (!cancelled) setBlocks(data.blocks ?? []);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load blocked users.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function unblock(userId: string) {
    setUnblockingId(userId);
    setError(null);
    try {
      const response = await fetch(`/api/blocks/${userId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not unblock this user.");
      setBlocks((current) => current.filter((entry) => entry.user.id !== userId));
      onBlockChange?.(userId, false);
    } catch (unblockError) {
      setError(
        unblockError instanceof Error
          ? unblockError.message
          : "Could not unblock this user.",
      );
    } finally {
      setUnblockingId(null);
    }
  }

  if (loading) {
    return <p className="text-sm text-[var(--muted)]">Loading blocked users…</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-[var(--text)]">Blocked users</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Their shared-server messages stay collapsed, and neither of you can start new DMs or friend requests.
        </p>
      </div>

      {error && (
        <p className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300" role="alert">
          {error}
        </p>
      )}

      {blocks.length === 0 ? (
        <p className="rounded-lg border border-[var(--accent-2)]/20 bg-[var(--panel-2)] px-3 py-4 text-center text-sm text-[var(--muted)]">
          You have not blocked anyone.
        </p>
      ) : (
        <ul className="space-y-2">
          {blocks.map((entry) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-lg border border-[var(--accent-2)]/20 bg-[var(--panel-2)] px-3 py-2"
            >
              <Avatar
                username={entry.user.username}
                avatarUrl={entry.user.avatar}
                size={36}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-[var(--text)]">
                  {displayName(entry.user.username)}
                </p>
                <p className="text-[10px] text-[var(--muted)]">
                  Blocked {new Date(entry.createdAt).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => unblock(entry.user.id)}
                disabled={unblockingId === entry.user.id}
                className="rounded px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              >
                {unblockingId === entry.user.id ? "Unblocking…" : "Unblock"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
