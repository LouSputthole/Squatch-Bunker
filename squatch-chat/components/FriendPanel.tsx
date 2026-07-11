"use client";

import { useState, useEffect, useCallback } from "react";
import Avatar from "@/components/Avatar";
import { displayName } from "@/lib/utils";

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

export default function FriendPanel({ currentUserId, onlineMemberIds, onMessageUser }: FriendPanelProps) {
  const [tab, setTab] = useState<Tab>("all");
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState("");
  const [addStatus, setAddStatus] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const [searchResults, setSearchResults] = useState<FriendUser[]>([]);
  const [searching, setSearching] = useState(false);

  const fetchFriends = useCallback(async () => {
    try {
      const res = await fetch("/api/friends");
      const data = await res.json();
      setFriends(data.friends || []);
      setIncoming(data.incoming || []);
      setOutgoing(data.outgoing || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchFriends(); }, [fetchFriends]);

  // Search users as they type
  useEffect(() => {
    if (tab !== "add" || addInput.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(addInput.trim())}`);
        const data = await res.json();
        setSearchResults(data.users || []);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [addInput, tab]);

  async function sendRequest(username: string) {
    setAddStatus(null);
    const res = await fetch("/api/friends", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const data = await res.json();
    if (res.ok) {
      setAddStatus({ type: "ok", msg: data.autoAccepted ? `Now friends with ${username}!` : `Request sent to ${username}` });
      setAddInput("");
      setSearchResults([]);
      fetchFriends();
    } else {
      setAddStatus({ type: "err", msg: data.error || "Failed" });
    }
  }

  async function acceptRequest(id: string) {
    await fetch(`/api/friends/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "accept" }),
    });
    fetchFriends();
  }

  async function rejectRequest(id: string) {
    await fetch(`/api/friends/${id}`, { method: "DELETE" });
    fetchFriends();
  }

  async function removeFriend(id: string) {
    await fetch(`/api/friends/${id}`, { method: "DELETE" });
    fetchFriends();
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
                  ? "bg-amber-600/20 text-amber-300"
                  : "text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--panel-2)]"
              }`}
            >
              {t.label}
              {t.badge ? (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] rounded-full flex items-center justify-center">
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
                        onRemove={() => removeFriend(f.id)}
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
                        onRemove={() => removeFriend(f.id)}
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
                          onClick={() => acceptRequest(r.id)}
                          className="w-8 h-8 rounded-full bg-green-600/20 text-green-400 hover:bg-green-600/30 flex items-center justify-center"
                          title="Accept"
                        >
                          ✓
                        </button>
                        <button
                          onClick={() => rejectRequest(r.id)}
                          className="w-8 h-8 rounded-full bg-red-600/20 text-red-400 hover:bg-red-600/30 flex items-center justify-center"
                          title="Reject"
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
                          onClick={() => rejectRequest(r.id)}
                          className="text-xs text-[var(--muted)] hover:text-red-400"
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
                onKeyDown={(e) => { if (e.key === "Enter" && addInput.trim()) sendRequest(addInput.trim()); }}
                placeholder="Enter username..."
                className="flex-1 bg-[var(--panel)] text-[var(--text)] text-sm px-3 py-2 rounded-lg border border-[var(--accent-2)]/30 focus:outline-none focus:border-amber-600/50"
              />
              <button
                onClick={() => addInput.trim() && sendRequest(addInput.trim())}
                disabled={!addInput.trim()}
                className="px-4 py-2 bg-amber-600/30 text-amber-300 rounded-lg text-sm hover:bg-amber-600/40 disabled:opacity-30 transition-colors"
              >
                Send
              </button>
            </div>

            {addStatus && (
              <p className={`text-xs mb-3 ${addStatus.type === "ok" ? "text-green-400" : "text-red-400"}`}>
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
                      onClick={() => sendRequest(u.username)}
                      className="text-xs px-3 py-1 bg-amber-600/20 text-amber-300 rounded hover:bg-amber-600/30"
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
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={onMessage}
          className="w-8 h-8 rounded-full bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)] flex items-center justify-center"
          title="Message"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button
          onClick={() => setShowMenu((p) => !p)}
          className="w-8 h-8 rounded-full bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)] flex items-center justify-center"
        >
          ⋯
        </button>
      </div>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute right-4 top-10 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl py-1 z-50 w-36">
            <button
              onClick={() => { onMessage(); setShowMenu(false); }}
              className="w-full px-3 py-1.5 text-left text-sm text-[var(--text)] hover:bg-[var(--accent-2)]/20"
            >
              Message
            </button>
            <button
              onClick={() => { onRemove(); setShowMenu(false); }}
              className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-red-600/10"
            >
              Remove Friend
            </button>
          </div>
        </>
      )}
    </div>
  );
}
