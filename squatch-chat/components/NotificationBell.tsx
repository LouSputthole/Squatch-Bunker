"use client";
import { useState, useEffect, useRef } from "react";

interface NotificationItem {
  id: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

interface NotificationBellProps {
  notifications: NotificationItem[];
  onMarkAllRead: () => void;
}

function relativeTime(timestamp: number): string {
  const diff = Math.floor((Date.now() - timestamp) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationBell({ notifications, onMarkAllRead }: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const recent = notifications.slice(0, 10);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        onClick={() => setOpen((p) => !p)}
        title="Notifications"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: open ? "var(--text)" : "var(--muted)",
          position: "relative",
          padding: 0,
          display: "flex",
          alignItems: "center",
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = open ? "var(--text)" : "var(--muted)")}
      >
        {/* Bell SVG */}
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {/* Badge */}
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-5px",
              right: "-5px",
              background: "var(--danger)",
              color: "#fff",
              borderRadius: "9999px",
              fontSize: "9px",
              fontWeight: 700,
              minWidth: "14px",
              height: "14px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
              lineHeight: 1,
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            right: 0,
            width: "280px",
            background: "var(--panel)",
            border: "1px solid color-mix(in srgb, var(--accent-2) 30%, transparent)",
            borderRadius: "10px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            zIndex: 100,
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "10px 12px 8px",
              borderBottom: "1px solid color-mix(in srgb, var(--accent-2) 20%, transparent)",
            }}
          >
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={() => { onMarkAllRead(); }}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "11px",
                  color: "var(--accent)",
                  padding: 0,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: "300px", overflowY: "auto" }}>
            {recent.length === 0 ? (
              <div
                style={{
                  padding: "20px 12px",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: "12px",
                }}
              >
                No notifications yet
              </div>
            ) : (
              recent.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid color-mix(in srgb, var(--accent-2) 15%, transparent)",
                    background: item.read ? "transparent" : "color-mix(in srgb, var(--accent) 8%, transparent)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: item.read ? 400 : 600,
                        color: "var(--text)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: "180px",
                      }}
                    >
                      {item.title}
                    </span>
                    <span style={{ fontSize: "10px", color: "var(--muted)", flexShrink: 0, marginLeft: "6px" }}>
                      {relativeTime(item.timestamp)}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--muted)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.body.length > 40 ? item.body.slice(0, 40) + "…" : item.body}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
