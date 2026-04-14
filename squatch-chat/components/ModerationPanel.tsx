"use client";

import { useState, useEffect, useCallback } from "react";

interface Member {
  id: string;
  username: string;
  avatar?: string | null;
  role?: string;
  banned?: boolean;
}

interface ModerationPanelProps {
  serverId: string;
  currentUserId: string;
  currentUserRole: string;
  open: boolean;
  onClose: () => void;
}

const ROLE_OPTIONS = ["admin", "mod", "member"] as const;

const ROLE_COLORS: Record<string, string> = {
  owner: "#f59e0b",
  admin: "#ef4444",
  mod: "#3b82f6",
  member: "",
};

function canActOn(currentUserRole: string, targetRole: string | undefined): boolean {
  if (targetRole === "owner") return false;
  if (currentUserRole === "owner") return true;
  if (currentUserRole === "admin" && targetRole !== "admin") return true;
  if (currentUserRole === "mod" && (!targetRole || targetRole === "member")) return true;
  return false;
}

export default function ModerationPanel({
  serverId,
  currentUserId,
  currentUserRole,
  open,
  onClose,
}: ModerationPanelProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingActions, setPendingActions] = useState<Set<string>>(new Set());

  const fetchMembers = useCallback(() => {
    setLoading(true);
    fetch(`/api/servers/${serverId}/members`)
      .then((res) => res.json())
      .then((data) => setMembers(data.members || []))
      .finally(() => setLoading(false));
  }, [serverId]);

  useEffect(() => {
    if (open) fetchMembers();
  }, [open, fetchMembers]);

  if (!open) return null;

  const query = search.trim().toLowerCase();
  const active = members.filter((m) => !m.banned && m.username.toLowerCase().includes(query));
  const banned = members.filter((m) => m.banned && m.username.toLowerCase().includes(query));

  function setPending(userId: string, on: boolean) {
    setPendingActions((prev) => {
      const next = new Set(prev);
      on ? next.add(userId) : next.delete(userId);
      return next;
    });
  }

  async function handleRoleChange(userId: string, role: string) {
    setPending(userId, true);
    const res = await fetch(`/api/servers/${serverId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) setMembers((prev) => prev.map((m) => (m.id === userId ? { ...m, role } : m)));
    setPending(userId, false);
  }

  async function handleBan(userId: string, ban: boolean) {
    if (ban && !confirm("Ban this member?")) return;
    setPending(userId, true);
    const res = await fetch(`/api/servers/${serverId}/members/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banned: ban }),
    });
    if (res.ok) setMembers((prev) => prev.map((m) => (m.id === userId ? { ...m, banned: ban } : m)));
    setPending(userId, false);
  }

  async function handleKick(userId: string) {
    if (!confirm("Kick this member?")) return;
    setPending(userId, true);
    const res = await fetch(`/api/servers/${serverId}/members/${userId}`, { method: "DELETE" });
    if (res.ok) setMembers((prev) => prev.filter((m) => m.id !== userId));
    setPending(userId, false);
  }

  function MemberRow({ m }: { m: Member }) {
    const isSelf = m.id === currentUserId;
    const canAct = !isSelf && canActOn(currentUserRole, m.role);
    const busy = pendingActions.has(m.id);
    const roleColor = ROLE_COLORS[m.role || "member"];
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    return (
      <li className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--panel-2)]/50 rounded-lg transition-colors">
        <div className="w-8 h-8 rounded-full bg-[var(--accent-2)] flex items-center justify-center text-sm font-semibold text-[var(--text)] shrink-0 select-none">
          {m.username[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate block" style={roleColor ? { color: roleColor } : { color: "var(--text)" }} title={m.username}>
            {m.username}
          </span>
          {m.role && <span className="text-xs" style={{ color: "var(--muted)" }}>{cap(m.role)}</span>}
        </div>
        {canAct && !m.banned && (
          <div className="flex items-center gap-1.5 shrink-0">
            <select
              disabled={busy}
              value={m.role || "member"}
              onChange={(e) => handleRoleChange(m.id, e.target.value)}
              className="text-xs px-1.5 py-1 rounded bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/40 focus:outline-none disabled:opacity-50 cursor-pointer"
              aria-label={`Change role for ${m.username}`}
            >
              {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{cap(r)}</option>)}
            </select>
            <button disabled={busy} onClick={() => handleKick(m.id)} aria-label={`Kick ${m.username}`}
              className="text-xs px-2 py-1 rounded bg-[var(--panel-2)] text-[var(--muted)] hover:bg-[var(--danger)]/20 hover:text-[var(--danger)] border border-[var(--accent-2)]/40 transition-colors disabled:opacity-50">
              Kick
            </button>
            <button disabled={busy} onClick={() => handleBan(m.id, true)} aria-label={`Ban ${m.username}`}
              className="text-xs px-2 py-1 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 border border-[var(--danger)]/30 transition-colors disabled:opacity-50">
              Ban
            </button>
          </div>
        )}
        {canAct && m.banned && (
          <button disabled={busy} onClick={() => handleBan(m.id, false)} aria-label={`Unban ${m.username}`}
            className="text-xs px-2 py-1 rounded bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--accent-2)]/40 transition-colors disabled:opacity-50">
            Unban
          </button>
        )}
      </li>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label="Server Moderation"
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl shadow-2xl border border-[var(--accent-2)]/30 overflow-hidden"
        style={{ background: "var(--panel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--accent-2)]/30" style={{ background: "var(--bg)" }}>
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Moderation Panel
            <span className="ml-2 text-xs font-normal" style={{ color: "var(--muted)" }}>
              {active.length} active · {banned.length} banned
            </span>
          </h2>
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded hover:bg-[var(--panel-2)] transition-colors"
            style={{ color: "var(--muted)" }}
            aria-label="Close moderation panel"
          >
            Close
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-[var(--accent-2)]/20" style={{ background: "var(--panel)" }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search members..."
            className="w-full text-sm px-3 py-2 rounded-lg border border-[var(--accent-2)]/40 focus:outline-none focus:border-[var(--accent)]"
            style={{ background: "var(--panel-2)", color: "var(--text)" }}
            aria-label="Search members"
          />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading ? (
            <div className="flex justify-center py-12 text-sm" style={{ color: "var(--muted)" }}>
              Loading members...
            </div>
          ) : (
            <>
              {/* Active members */}
              <section aria-label="Active members">
                <p className="text-xs font-semibold uppercase tracking-wide mb-1.5 px-1" style={{ color: "var(--muted)" }}>
                  Members — {active.length}
                </p>
                {active.length === 0 ? (
                  <p className="text-xs px-1" style={{ color: "var(--muted)" }}>No members found.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {active.map((m) => <MemberRow key={m.id} m={m} />)}
                  </ul>
                )}
              </section>

              {/* Banned members */}
              {banned.length > 0 && (
                <section aria-label="Banned members">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1.5 px-1 text-[var(--danger)]">
                    Banned — {banned.length}
                  </p>
                  <ul className="space-y-0.5 opacity-70">
                    {banned.map((m) => <MemberRow key={m.id} m={m} />)}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
