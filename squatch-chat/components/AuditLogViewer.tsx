"use client";

import { useState, useEffect, useCallback } from "react";
import Avatar from "@/components/Avatar";

interface AuditEntry {
  id: string;
  action: string;
  detail?: string | null;
  createdAt: string;
  actor: { id: string; username: string; avatar?: string | null };
  target?: { id: string; username: string; avatar?: string | null } | null;
}

interface AuditLogViewerProps {
  serverId: string;
  open: boolean;
  onClose: () => void;
}

const ACTION_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  message_purge: { label: "Purged Messages", icon: "🗑️", color: "text-red-400" },
  channel_permission_update: { label: "Updated Permissions", icon: "🔒", color: "text-yellow-400" },
  member_ban: { label: "Banned Member", icon: "🚫", color: "text-red-400" },
  member_unban: { label: "Unbanned Member", icon: "✅", color: "text-green-400" },
  member_kick: { label: "Kicked Member", icon: "👢", color: "text-orange-400" },
  member_role_change: { label: "Changed Role", icon: "👑", color: "text-purple-400" },
  channel_create: { label: "Created Channel", icon: "📝", color: "text-blue-400" },
  channel_delete: { label: "Deleted Channel", icon: "🗑️", color: "text-red-400" },
  server_update: { label: "Updated Server", icon: "⚙️", color: "text-blue-400" },
};

function formatAction(action: string) {
  return ACTION_LABELS[action] || { label: action.replace(/_/g, " "), icon: "📋", color: "text-[var(--muted)]" };
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function AuditLogViewer({ serverId, open, onClose }: AuditLogViewerProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [actionFilter, setActionFilter] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      let url = `/api/servers/${serverId}/audit-log?page=${page}&limit=25`;
      if (actionFilter) url += `&action=${encodeURIComponent(actionFilter)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries || []);
        setTotalPages(data.pages || 1);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [serverId, page, actionFilter]);

  useEffect(() => {
    if (!open) return;
    fetchLogs();
  }, [open, fetchLogs]);

  if (!open) return null;

  const actionTypes = Object.keys(ACTION_LABELS);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl overflow-hidden"
        style={{ maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--accent-2)]/20">
          <h2 className="text-lg font-bold text-[var(--text)]">Audit Log</h2>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)] text-xl leading-none">&times;</button>
        </div>

        {/* Filter bar */}
        <div className="px-5 py-2 border-b border-[var(--accent-2)]/10 flex items-center gap-2">
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
            className="text-xs px-2 py-1.5 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none"
          >
            <option value="">All Actions</option>
            {actionTypes.map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a].label}</option>
            ))}
          </select>
          <button
            onClick={fetchLogs}
            className="text-xs text-[var(--accent-2)] hover:text-[var(--accent)] transition-colors ml-auto"
          >
            Refresh
          </button>
        </div>

        {/* Log entries */}
        <div className="overflow-y-auto" style={{ maxHeight: "calc(80vh - 140px)" }}>
          {loading && (
            <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">Loading...</div>
          )}

          {!loading && entries.length === 0 && (
            <div className="px-5 py-8 text-center text-sm text-[var(--muted)]">No audit log entries</div>
          )}

          {!loading && entries.map((entry) => {
            const info = formatAction(entry.action);
            return (
              <div key={entry.id} className="px-5 py-3 border-b border-[var(--accent-2)]/10 hover:bg-[var(--panel-2)]/30 transition-colors">
                <div className="flex items-start gap-3">
                  <Avatar username={entry.actor.username} avatarUrl={entry.actor.avatar} size={32} className="bg-[var(--accent-2)] text-[var(--text)] shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-[var(--text)]">{entry.actor.username}</span>
                      <span className={`text-xs font-medium ${info.color}`}>
                        {info.icon} {info.label}
                      </span>
                      {entry.target && (
                        <>
                          <span className="text-xs text-[var(--muted)]">→</span>
                          <span className="text-xs text-[var(--text)]">{entry.target.username}</span>
                        </>
                      )}
                      <span className="text-xs text-[var(--muted)] ml-auto shrink-0">{formatTime(entry.createdAt)}</span>
                    </div>
                    {entry.detail && (
                      <p className="text-xs text-[var(--muted)] mt-0.5 truncate">{entry.detail}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-5 py-2 border-t border-[var(--accent-2)]/20 flex items-center justify-between">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-xs px-3 py-1 rounded bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30 transition-colors"
            >
              Previous
            </button>
            <span className="text-xs text-[var(--muted)]">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-xs px-3 py-1 rounded bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-30 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
