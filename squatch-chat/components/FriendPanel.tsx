"use client";

import { useState, useEffect, useCallback } from "react";
import Avatar from "@/components/Avatar";
import PromptDialog from "@/components/PromptDialog";
import { useEscape } from "@/hooks/useEscape";
import { displayName } from "@/lib/utils";
import { toast, toastResponseError } from "@/lib/toast";

interface FriendUser {
  id: string;
  username: string;
  avatar?: string | null;
}

interface Friend {
  id: string;
  user: FriendUser;
  since: string;
}

interface FriendRequest {
  id: string;
  user: FriendUser;
  sentAt: string;
}

type Tab = "all" | "pending" | "add";

interface FriendPanelProps {
  currentUserId: string;
  onlineMemberIds: Set<string>;
  onMessageUser: (userId: string) => void;
}

export default function FriendPanel({ onlineMemberIds, onMessageUser }: FriendPanelProps) {
  const [tab, setTab] = useState<Tab>("all");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState("");
  const [addStatus, setAddStatus] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<Friend | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const searchQuery = tab === "add" && addInput.trim().length >= 2 ? addInput.trim() : "";
  const [searchState, setSearchState] = useState<{
    query: string;
    users: FriendUser[];
    searching: boolean;
  }>({ query: "", users: [], searching: false });
  const currentSearch = searchState.query === searchQuery ? searchState : null;
  const searchResults = currentSearch?.users ?? [];
  const searching = currentSearch?.searching ?? false;

  const fetchFriends = useCallback(async () => {
    try {
      const res = await fetch("/api/friends");
      if (!res.ok) {
        await toastResponseError(res, "Couldn't load your friends list");
        return;
      }
      const data = await res.json();
      setFriends(data.friends || []);
      setIncoming(data.incoming || []);
      setOutgoing(data.outgoing || []);
    } catch {
      toast("Couldn't load your friends list", "error");
    } finally {
      setLoading(false);
    }
  }, []);

  /** Runs a friendship mutation, toasting the server's error on failure. */
  async function mutateFriendship(id: string, init: RequestInit, failure: string, success?: string) {
    if (busyIds.has(id)) return;
    setBusyIds((current) => new Set(current).add(id));
    try {
      const res = await fetch(`/api/friends/${id}`, init);
      if (!res.ok) {
        await toastResponseError(res, failure);
        return;
      }
      if (success) toast(success, "success");
      await fetchFriends();
    } catch {
      toast(failure, "error");
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => { void fetchFriends(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchFriends]);

  // Search users as they type
  useEffect(() => {
    if (!searchQuery) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setSearchState({ query: searchQuery, users: [], searching: true });
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(searchQuery)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        if (!controller.signal.aborted) {
          setSearchState({ query: searchQuery, users: data.users || [], searching: false });
        }
      } catch {
        if (!controller.signal.aborted) {
          setSearchState({ query: searchQuery, users: [], searching: false });
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery]);

  async function sendRequest(username: string) {
    setAddStatus(null);
    try {
      const res = await fetch("/api/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setAddStatus({ type: "ok", msg: data.autoAccepted ? `Now friends with ${username}!` : `Request sent to ${username}` });
        setAddInput("");
        setSearchState({ query: "", users: [], searching: false });
        void fetchFriends();
      } else {
        setAddStatus({ type: "err", msg: data.error || "Couldn't send the friend request" });
      }
    } catch {
      setAddStatus({ type: "err", msg: "Couldn't send the friend request. Check your connection." });
    }
  }

  function acceptRequest(id: string) {
    return mutateFriendship(
      id,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "accept" }) },
      "Couldn't accept the request",
    );
  }

  function rejectRequest(id: string, failure = "Couldn't decline the request") {
    return mutateFriendship(id, { method: "DELETE" }, failure);
  }

  async function removeFriend(friend: Friend) {
    await mutateFriendship(
      friend.id,
      { method: "DELETE" },
      "Couldn't remove friend",
      `Removed ${displayName(friend.user.username)} from your friends`,
    );
    setPendingRemoval(null);
  }

  const onlineFriends = friends.filter((f) => onlineMemberIds.has(f.user.id));
  const offlineFriends = friends.filter((f) => !onlineMemberIds.has(f.user.id));
  const pendingCount = incoming.length;

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending", badge: pendingCount },
    { key: "add", label: "Add Friend" },
  ];

  return (
    <div className="flex-1 flex flex-col bg-[var(--panel-2)] h-full">
      {/* Header */}
      <div className="h-12 px-4 flex items-center gap-4 border-b border-[var(--accent-2)]/30 bg-[var(--panel)] shrink-0">
        <span className="text-sm font-semibold text-[var(--text)]">Friends</span>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setAddStatus(null); }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors relative ${
                tab === t.key
                  ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-2)]"
              }`}
            >
              {t.label}
              {t.badge ? (
                <span
                  aria-label={`${t.badge} pending`}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--danger)] text-white text-[9px] rounded-full flex items-center justify-center"
                >
                  {t.badge}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[var(--accent-2)]/30 animate-pulse" />
                <div className="h-3 w-28 bg-[var(--accent-2)]/30 animate-pulse rounded" />
              </div>
            ))}
          </div>
        ) : tab === "all" ? (
          <div>
            {friends.length === 0 ? (
              <div className="p-8 text-center text-[var(--muted)] text-sm">
                <p className="text-base mb-1">No friends yet</p>
                <p className="text-xs">Add friends by username to get started</p>
              </div>
            ) : (
              <>
                {/* Online */}
                {onlineFriends.length > 0 && (
                  <div>
                    <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                      Online — {onlineFriends.length}
                    </div>
                    {onlineFriends.map((f) => (
                      <FriendRow
                        key={f.id}
                        friend={f}
                        online
                        onMessage={() => onMessageUser(f.user.id)}
                        onRemove={() => setPendingRemoval(f)}
                      />
                    ))}
                  </div>
                )}
                {/* Offline */}
                {offlineFriends.length > 0 && (
                  <div>
                    <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                      Offline — {offlineFriends.length}
                    </div>
                    {offlineFriends.map((f) => (
                      <FriendRow
                        key={f.id}
                        friend={f}
                        online={false}
                        onMessage={() => onMessageUser(f.user.id)}
                        onRemove={() => setPendingRemoval(f)}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : tab === "pending" ? (
          <div>
            {incoming.length === 0 && outgoing.length === 0 ? (
              <div className="p-8 text-center text-[var(--muted)] text-sm">No pending requests</div>
            ) : (
              <>
                {incoming.length > 0 && (
                  <div>
                    <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                      Incoming — {incoming.length}
                    </div>
                    {incoming.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--panel)]/50">
                        <Avatar username={r.user.username} avatarUrl={r.user.avatar} size={40} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--text)] truncate">{displayName(r.user.username)}</p>
                          <p className="text-[10px] text-[var(--muted)]">Incoming request</p>
                        </div>
                        <button
                          onClick={() => void acceptRequest(r.id)}
                          disabled={busyIds.has(r.id)}
                          className="w-8 h-8 rounded-full bg-[var(--accent)]/20 text-[var(--accent)] hover:bg-[var(--accent)]/30 flex items-center justify-center disabled:opacity-50"
                          title="Accept"
                          aria-label={`Accept friend request from ${displayName(r.user.username)}`}
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => void rejectRequest(r.id)}
                          disabled={busyIds.has(r.id)}
                          className="w-8 h-8 rounded-full bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30 flex items-center justify-center disabled:opacity-50"
                          title="Decline"
                          aria-label={`Decline friend request from ${displayName(r.user.username)}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {outgoing.length > 0 && (
                  <div>
                    <div className="px-4 pt-4 pb-1 text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                      Outgoing — {outgoing.length}
                    </div>
                    {outgoing.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--panel)]/50">
                        <Avatar username={r.user.username} avatarUrl={r.user.avatar} size={40} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--text)] truncate">{displayName(r.user.username)}</p>
                          <p className="text-[10px] text-[var(--muted)]">Sent request</p>
                        </div>
                        <button
                          onClick={() => void rejectRequest(r.id, "Couldn't cancel the request")}
                          disabled={busyIds.has(r.id)}
                          aria-label={`Cancel friend request to ${displayName(r.user.username)}`}
                          className="text-xs text-[var(--muted)] hover:text-[var(--danger)] disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          /* Add Friend tab */
          <div className="p-4">
            <p className="text-sm text-[var(--text)] mb-3">Add a friend by username or search:</p>
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={addInput}
                onChange={(e) => { setAddInput(e.target.value); setAddStatus(null); }}
                onKeyDown={(e) => { if (e.key === "Enter" && addInput.trim()) void sendRequest(addInput.trim()); }}
                placeholder="Enter username..."
                aria-label="Username to add"
                className="flex-1 bg-[var(--panel)] text-[var(--text)] text-sm px-3 py-2 rounded-lg border border-[var(--accent-2)]/30 focus:outline-none focus:border-[var(--accent)]/60"
              />
              <button
                onClick={() => { if (addInput.trim()) void sendRequest(addInput.trim()); }}
                disabled={!addInput.trim()}
                className="px-4 py-2 bg-[var(--accent-2)]/40 text-[var(--text)] rounded-lg text-sm hover:bg-[var(--accent-2)]/60 disabled:opacity-30 transition-colors"
              >
                Send
              </button>
            </div>

            {addStatus && (
              <p
                role={addStatus.type === "err" ? "alert" : "status"}
                className={`text-xs mb-3 ${addStatus.type === "ok" ? "text-[var(--accent)]" : "text-[var(--danger)]"}`}
              >
                {addStatus.msg}
              </p>
            )}

            {/* Live search results */}
            {searching && <p className="text-xs text-[var(--muted)] mb-2">Searching...</p>}
            {searchResults.length > 0 && (
              <div className="space-y-1">
                <p className="text-[10px] text-[var(--muted)] uppercase tracking-wider mb-1">Users found</p>
                {searchResults.map((u) => (
                  <div key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--panel)] transition-colors">
                    <Avatar username={u.username} avatarUrl={u.avatar} size={36} />
                    <span className="text-sm text-[var(--text)] flex-1 truncate">{displayName(u.username)}</span>
                    <button
                      onClick={() => void sendRequest(u.username)}
                      aria-label={`Send friend request to ${displayName(u.username)}`}
                      className="text-xs px-3 py-1 bg-[var(--accent-2)]/30 text-[var(--text)] rounded hover:bg-[var(--accent-2)]/50"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {pendingRemoval && (
        <PromptDialog
          mode="confirm"
          title={`Remove ${displayName(pendingRemoval.user.username)}?`}
          message="They won't be notified. You can send a new friend request later."
          confirmLabel="Remove friend"
          destructive
          onConfirm={() => removeFriend(pendingRemoval)}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
    </div>
  );
}

function FriendRow({
  friend,
  online,
  onMessage,
  onRemove,
}: {
  friend: Friend;
  online: boolean;
  onMessage: () => void;
  onRemove: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const name = displayName(friend.user.username);

  useEscape(() => setShowMenu(false), showMenu);

  return (
    <div
      className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--panel)]/50 group relative"
      onContextMenu={(e) => { e.preventDefault(); setShowMenu(true); }}
    >
      <div className="relative">
        <Avatar username={friend.user.username} avatarUrl={friend.user.avatar} size={40} />
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[var(--panel-2)] ${
            online ? "bg-green-500" : "bg-gray-500"
          }`}
        />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text)] truncate">{displayName(friend.user.username)}</p>
        <p className="text-[10px] text-[var(--muted)]">{online ? "Online" : "Offline"}</p>
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity">
        <button
          onClick={onMessage}
          className="w-8 h-8 rounded-full bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)] flex items-center justify-center"
          title="Message"
          aria-label={`Message ${name}`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button
          onClick={() => setShowMenu((p) => !p)}
          className="w-8 h-8 rounded-full bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)] flex items-center justify-center"
          title="More options"
          aria-label={`More options for ${name}`}
          aria-haspopup="menu"
          aria-expanded={showMenu}
        >
          ⋯
        </button>
      </div>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div role="menu" className="absolute right-4 top-10 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl py-1 z-50 w-36">
            <button
              role="menuitem"
              onClick={() => { onMessage(); setShowMenu(false); }}
              className="w-full px-3 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--accent-2)]/20"
            >
              Message
            </button>
            <button
              role="menuitem"
              onClick={() => { onRemove(); setShowMenu(false); }}
              className="w-full px-3 py-1.5 text-left text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10"
            >
              Remove Friend
            </button>
          </div>
        </>
      )}
    </div>
  );
}
