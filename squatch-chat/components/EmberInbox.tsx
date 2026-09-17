"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDismissable } from "@/hooks/useDismissable";
import { useNotifications } from "@/hooks/useNotifications";
import { getSocket } from "@/lib/socket";

export interface InboxNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  serverId: string | null;
  channelId: string | null;
  conversationId: string | null;
  messageId: string | null;
  actorId: string | null;
  readAt: string | null;
  createdAt: string;
}

interface EmberInboxProps {
  currentServerId?: string | null;
  currentChannelId?: string | null;
  onNavigate?: (notification: InboxNotification) => void;
}

const TYPE_ICONS: Record<string, string> = {
  mention: "@",
  reply: "↩",
  dm: "✉",
  friend_request: "🤝",
};

function relativeTime(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${Math.max(diff, 0)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function minutesNow(): number {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

/** Quiet windows may wrap midnight (e.g. 22:00 → 07:00). */
export function isQuietAt(minute: number, start: number | null, end: number | null): boolean {
  if (start === null || end === null || start === end) return false;
  return start < end
    ? minute >= start && minute < end
    : minute >= start || minute < end;
}

function toTimeInput(minutes: number | null): string {
  if (minutes === null) return "";
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function fromTimeInput(value: string): number | null {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export default function EmberInbox({ currentServerId, currentChannelId, onNavigate }: EmberInboxProps) {
  const { open, setOpen, ref: containerRef } = useDismissable();
  const { notify } = useNotifications();

  const [items, setItems] = useState<InboxNotification[]>([]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [quietStart, setQuietStart] = useState<number | null>(null);
  const [quietEnd, setQuietEnd] = useState<number | null>(null);
  const [spaceLevel, setSpaceLevel] = useState<string>("all");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications);
      setUnreadCount(data.unreadCount);
      setNextCursor(data.nextCursor);
    } catch {
      // offline — the badge just goes stale until the next refresh
    }
  }, []);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => {
      void refresh();
      void fetch("/api/notifications/settings")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) {
            setQuietStart(data.quietHoursStart);
            setQuietEnd(data.quietHoursEnd);
          }
        })
        .catch(() => {});
    }, 0);
    return () => window.clearTimeout(loadTimer);
  }, [refresh]);

  useEffect(() => {
    const socket = getSocket();
    function onNew(notification: InboxNotification) {
      // A refreshed DM entry re-emits the same id: only count it when it was
      // not already sitting here unread, or the badge outruns the real total.
      const alreadyUnread = itemsRef.current.some((n) => n.id === notification.id && !n.readAt);
      setItems((prev) => [notification, ...prev.filter((n) => n.id !== notification.id)]);
      if (!alreadyUnread) setUnreadCount((prev) => prev + 1);
      if (!isQuietAt(minutesNow(), quietStart, quietEnd)) {
        notify(notification.title, notification.body);
      }
    }
    socket.on("notification:new", onNew);
    return () => {
      socket.off("notification:new", onNew);
    };
  }, [notify, quietStart, quietEnd]);

  // Per-space policy for the space currently on screen.
  useEffect(() => {
    if (!open || !currentServerId) return;
    fetch("/api/notification-preferences")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data?.preferences) return;
        const prefs = data.preferences as Array<{ serverId: string | null; channelId: string | null; level: string }>;
        const match = prefs.find((p) => p.serverId === currentServerId
          && p.channelId === (currentChannelId ?? null))
          ?? prefs.find((p) => p.serverId === currentServerId && p.channelId === null);
        setSpaceLevel(match?.level ?? "all");
      })
      .catch(() => {});
  }, [open, currentServerId, currentChannelId]);

  const markRead = useCallback(async (ids: string[]) => {
    setItems((prev) => prev.map((n) =>
      ids.includes(n.id) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n));
    setUnreadCount((prev) => Math.max(0, prev - ids.length));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }).catch(() => {});
  }, []);

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    setUnreadCount(0);
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  }, []);

  const clearAll = useCallback(async () => {
    setItems([]);
    setUnreadCount(0);
    setNextCursor(null);
    await fetch("/api/notifications", { method: "DELETE" }).catch(() => {});
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const res = await fetch(`/api/notifications?cursor=${encodeURIComponent(nextCursor)}`).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json();
    setItems((prev) => {
      const known = new Set(prev.map((n) => n.id));
      return [...prev, ...data.notifications.filter((n: InboxNotification) => !known.has(n.id))];
    });
    setNextCursor(data.nextCursor);
  }, [nextCursor]);

  const saveQuietHours = useCallback(async (start: number | null, end: number | null) => {
    setQuietStart(start);
    setQuietEnd(end);
    const clearing = start === null || end === null;
    await fetch("/api/notifications/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clearing
        ? { quietHoursStart: null, quietHoursEnd: null }
        : { quietHoursStart: start, quietHoursEnd: end }),
    }).catch(() => {});
  }, []);

  const saveSpaceLevel = useCallback(async (level: string) => {
    if (!currentServerId) return;
    setSpaceLevel(level);
    await fetch("/api/notification-preferences", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId: currentServerId, channelId: currentChannelId ?? null, level }),
    }).catch(() => {});
  }, [currentServerId, currentChannelId]);

  const quietNow = isQuietAt(minutesNow(), quietStart, quietEnd);

  function handleItemClick(notification: InboxNotification) {
    if (!notification.readAt) markRead([notification.id]);
    setOpen(false);
    onNavigate?.(notification);
  }

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => { setOpen((p) => !p); if (!open) refresh(); }}
        title={quietNow ? "Ember Inbox (quiet hours active)" : "Ember Inbox"}
        aria-label="Ember Inbox"
        style={{ background: "none", border: "none", cursor: "pointer", color: open ? "var(--text)" : "var(--muted)", position: "relative", display: "inline-flex", padding: 0 }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {quietNow && (
          <span style={{ position: "absolute", top: -3, left: -5, fontSize: 8 }} aria-hidden="true">🌙</span>
        )}
        {unreadCount > 0 && (
          <span style={{ position: "absolute", top: -5, right: -7, background: "var(--danger)", color: "#fff", borderRadius: 8, fontSize: 9, lineHeight: "13px", minWidth: 13, height: 13, padding: "0 3px", textAlign: "center", fontWeight: 700 }}>
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: "absolute", bottom: "calc(100% + 8px)", right: -8, width: 320, maxHeight: 420, display: "flex", flexDirection: "column", background: "var(--panel)", border: "1px solid var(--muted)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 60, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid rgba(128,128,128,0.2)" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Ember Inbox</span>
            <span style={{ display: "inline-flex", gap: 8 }}>
              <button onClick={() => setShowSettings((p) => !p)} title="Notification settings" aria-label="Notification settings" style={{ background: "none", border: "none", cursor: "pointer", color: showSettings ? "var(--accent)" : "var(--muted)", fontSize: 11 }}>
                ⚙
              </button>
              {unreadCount > 0 && (
                <button onClick={markAllRead} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 11 }}>
                  Mark all read
                </button>
              )}
            </span>
          </div>

          {showSettings && (
            <div style={{ padding: "8px 12px", borderBottom: "1px solid rgba(128,128,128,0.2)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--text)", marginBottom: 4 }}>
                  Quiet hours {quietNow && <em style={{ color: "var(--muted)" }}>(active now)</em>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="time" value={toTimeInput(quietStart)} aria-label="Quiet hours start"
                    onChange={(e) => saveQuietHours(fromTimeInput(e.target.value), quietEnd ?? fromTimeInput(e.target.value))}
                    style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--muted)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>to</span>
                  <input type="time" value={toTimeInput(quietEnd)} aria-label="Quiet hours end"
                    onChange={(e) => saveQuietHours(quietStart ?? fromTimeInput(e.target.value), fromTimeInput(e.target.value))}
                    style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--muted)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
                  {(quietStart !== null || quietEnd !== null) && (
                    <button onClick={() => saveQuietHours(null, null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 11 }}>
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                  Sounds and pop-ups pause; the inbox still collects everything.
                </div>
              </div>
              {currentServerId && (
                <div>
                  <div style={{ fontSize: 11, color: "var(--text)", marginBottom: 4 }}>
                    {currentChannelId ? "This channel" : "This camp"} notifies me about
                  </div>
                  <select value={spaceLevel} onChange={(e) => saveSpaceLevel(e.target.value)} aria-label="Notification policy for this space"
                    style={{ background: "var(--bg)", color: "var(--text)", border: "1px solid var(--muted)", borderRadius: 4, fontSize: 11, padding: "2px 4px", width: "100%" }}>
                    <option value="all">Mentions and replies</option>
                    <option value="mentions">Mentions only</option>
                    <option value="none">Nothing</option>
                  </select>
                </div>
              )}
            </div>
          )}

          <div style={{ overflowY: "auto", flex: 1 }}>
            {items.length === 0 ? (
              <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
                The fire is calm — nothing new.
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleItemClick(n)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: n.readAt ? "none" : "rgba(245,158,11,0.06)", border: "none", borderBottom: "1px solid rgba(128,128,128,0.12)", cursor: "pointer", padding: "8px 12px" }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span aria-hidden="true" style={{ fontSize: 11, color: "var(--accent)", flexShrink: 0 }}>
                      {TYPE_ICONS[n.type] ?? "•"}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text)", fontWeight: n.readAt ? 400 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {n.title}
                    </span>
                    <span style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>{relativeTime(n.createdAt)}</span>
                  </div>
                  {n.body && (
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {n.body}
                    </div>
                  )}
                </button>
              ))
            )}
            {nextCursor && (
              <button onClick={loadMore} style={{ display: "block", width: "100%", background: "none", border: "none", cursor: "pointer", color: "var(--accent)", fontSize: 11, padding: "8px 12px" }}>
                Load older
              </button>
            )}
          </div>

          {items.length > 0 && (
            <div style={{ borderTop: "1px solid rgba(128,128,128,0.2)", padding: "6px 12px", textAlign: "right" }}>
              <button onClick={clearAll} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 11 }}>
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
