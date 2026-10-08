"use client";

import { useState, useEffect, useCallback } from "react";
import PromptDialog, { type PromptDialogRequest } from "@/components/PromptDialog";
import { useEscape } from "@/hooks/useEscape";
import { toast, toastResponseError } from "@/lib/toast";

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

// Same warm palette as MemberList.
const ROLE_COLORS: Record<string, string> = {
  owner: "#f5b942",
  admin: "#ef5d4f",
  mod: "#7fb8a4",
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
  const [loadError, setLoadError] = useState(false);
  const [dialog, setDialog] = useState<PromptDialogRequest | null>(null);

  const fetchMembers = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    fetch(`/api/servers/${serverId}/members`)
      .then((res) => {
        if (!res.ok) throw new Error(`members ${res.status}`);
        return res.json();
      })
      .then((data) => setMembers(data.members || []))
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [serverId]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(fetchMembers, 0);
    return () => clearTimeout(timer);
  }, [open, fetchMembers]);

  useEscape(onClose, open && !dialog);

  if (!open) return null;

  const query = search.trim().toLowerCase();
  const active = members.filter((m) => !m.banned && m.username.toLowerCase().includes(query));
  const banned = members.filter((m) => m.banned && m.username.toLowerCase().includes(query));

  function setPending(userId: string, on: boolean) {
    setPendingActions((prev) => {
      const next = new Set(prev);
      if (on) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  /** Runs a member mutation; toasts the server's error and returns false on failure. */
  async function memberRequest(userId: string, init: RequestInit, fallback: string): Promise<boolean> {
    setPending(userId, true);
    try {
      const res = await fetch(`/api/servers/${serverId}/members/${userId}`, init);
      if (!res.ok) {
        await toastResponseError(res, fallback);
        return false;
      }
      return true;
    } catch {
      toast(fallback, "error");
      return false;
    } finally {
      setPending(userId, false);
    }
  }

  async function handleRoleChange(userId: string, role: string) {
    const ok = await memberRequest(userId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    }, "Failed to change role");
    if (ok) setMembers((prev) => prev.map((m) => (m.id === userId ? { ...m, role } : m)));
  }

  async function applyBan(userId: string, ban: boolean): Promise<boolean> {
    const ok = await memberRequest(userId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banned: ban }),
    }, ban ? "Failed to ban member" : "Failed to unban member");
    if (ok) setMembers((prev) => prev.map((m) => (m.id === userId ? { ...m, banned: ban } : m)));
    return ok;
  }

  function handleBan(m: Member, ban: boolean) {
    if (!ban) {
      void applyBan(m.id, false);
      return;
    }
    setDialog({
      title: `Ban ${m.username}?`,
      message: "They'll be removed and can't rejoin until unbanned.",
      mode: "confirm",
      confirmLabel: "Ban",
      destructive: true,
      onConfirm: async () => {
        if (await applyBan(m.id, true)) setDialog(null);
      },
    });
  }

  function handleKick(m: Member) {
    setDialog({
      title: `Kick ${m.username}?`,
      message: "They'll be removed from the server but can rejoin with an invite.",
      mode: "confirm",
      confirmLabel: "Kick",
      destructive: true,
      onConfirm: async () => {
        const ok = await memberRequest(m.id, { method: "DELETE" }, "Failed to kick member");
        if (!ok) return;
        setMembers((prev) => prev.filter((member) => member.id !== m.id));
        setDialog(null);
      },
    });
  }

  // A render helper rather than a nested component, so rows (and their role
  // <select>) aren't remounted on every state change.
  function renderMemberRow(m: Member) {
    const isSelf = m.id === currentUserId;
    const canAct = !isSelf && canActOn(currentUserRole, m.role);
    const busy = pendingActions.has(m.id);
    const roleColor = ROLE_COLORS[m.role || "member"];
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

    return (
      <li key={m.id} className="flex items-center gap-3 px-4 py-2 hover:bg-[var(--panel-2)]/50 rounded-lg transition-colors">
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
            <button disabled={busy} onClick={() => handleKick(m)} aria-label={`Kick ${m.username}`}
              className="text-xs px-2 py-1 rounded bg-[var(--panel-2)] text-[var(--muted)] hover:bg-[var(--danger)]/20 hover:text-[var(--danger)] border border-[var(--accent-2)]/40 transition-colors disabled:opacity-50">
              Kick
            </button>
            <button disabled={busy} onClick={() => handleBan(m, true)} aria-label={`Ban ${m.username}`}
              className="text-xs px-2 py-1 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 border border-[var(--danger)]/30 transition-colors disabled:opacity-50">
              Ban
            </button>
          </div>
        )}
        {canAct && m.banned && (
          <button disabled={busy} onClick={() => handleBan(m, false)} aria-label={`Unban ${m.username}`}
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
            autoFocus
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
          ) : loadError ? (
            <div className="flex flex-col items-center gap-2 py-12 text-sm" role="alert" style={{ color: "var(--muted)" }}>
              Couldn&apos;t load members.
              <button
                onClick={fetchMembers}
                className="text-xs px-3 py-1 rounded bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)] transition-colors"
              >
                Retry
              </button>
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
                    {active.map((m) => renderMemberRow(m))}
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
                    {banned.map((m) => renderMemberRow(m))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>
      </div>
      {dialog && (
        <div onClick={(e) => e.stopPropagation()}>
          <PromptDialog key={dialog.title} {...dialog} onCancel={() => setDialog(null)} />
        </div>
      )}
    </div>
  );
}
