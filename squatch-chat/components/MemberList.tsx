"use client";

import { useState, useEffect } from "react";
import { truncateName, displayName } from "@/lib/utils";
import Avatar from "@/components/Avatar";

const ROLE_COLORS: Record<string, string> = {
  owner: "#f59e0b",
  admin: "#ef4444",
  mod: "#3b82f6",
  member: "",
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  mod: "Mod",
  member: "",
};

interface Member {
  id: string;
  username: string;
  avatar?: string | null;
  role?: string;
}

interface MemberListProps {
  serverId: string;
  currentUserId?: string;
  currentUserRole?: string;
  onlineMemberIds: Set<string>;
  memberStatuses?: Map<string, string>;
}

const STATUS_COLORS: Record<string, string> = {
  online: "bg-green-500",
  idle: "bg-yellow-500",
  dnd: "bg-red-500",
  invisible: "bg-gray-500",
};

export default function MemberList({ serverId, currentUserId, currentUserRole, onlineMemberIds, memberStatuses }: MemberListProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteCode, setInviteCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [contextMenu, setContextMenu] = useState<{ memberId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    fetch(`/api/servers/${serverId}/members`)
      .then((res) => res.json())
      .then((data) => {
        setMembers(data.members || []);
        setInviteCode(data.inviteCode || "");
      });
  }, [serverId]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const onlineMembers = members.filter((m) => onlineMemberIds.has(m.id));
  const offlineMembers = members.filter((m) => !onlineMemberIds.has(m.id));

  function copyInvite() {
    const link = `${window.location.origin}/join/${inviteCode}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const canManage = currentUserRole === "owner" || currentUserRole === "admin";

  async function handleRoleChange(userId: string, role: string) {
    setContextMenu(null);
    const res = await fetch(`/api/servers/${serverId}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    if (res.ok) {
      setMembers((prev) => prev.map((m) => m.id === userId ? { ...m, role } : m));
    }
  }

  async function handleKick(userId: string) {
    setContextMenu(null);
    if (!confirm("Kick this member?")) return;
    const res = await fetch(`/api/servers/${serverId}/members/${userId}`, { method: "DELETE" });
    if (res.ok) {
      setMembers((prev) => prev.filter((m) => m.id !== userId));
    }
  }

  function renderMember(m: Member, online: boolean) {
    const roleColor = ROLE_COLORS[m.role || "member"];
    const roleLabel = ROLE_LABELS[m.role || "member"];
    const isSelf = m.id === currentUserId;

    return (
      <div
        key={m.id}
        className={`flex items-center gap-2 px-3 py-1 ${online ? "" : "opacity-50"} ${canManage && !isSelf ? "cursor-pointer hover:bg-[var(--panel-2)]/50 rounded" : ""}`}
        onContextMenu={(e) => {
          if (canManage && !isSelf) {
            e.preventDefault();
            setContextMenu({ memberId: m.id, x: e.clientX, y: e.clientY });
          }
        }}
      >
        <Avatar
          username={m.username}
          avatarUrl={m.avatar}
          size={32}
          className={online ? "bg-[var(--accent-2)] text-[var(--text)]" : "bg-[var(--panel-2)] text-[var(--muted)]"}
        />
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${
            online
              ? (STATUS_COLORS[memberStatuses?.get(m.id) || "online"] || "bg-green-500")
              : "bg-[var(--muted)]"
          }`} />
          <span
            className={`text-sm truncate ${online ? "text-[var(--text)]" : "text-[var(--muted)]"}`}
            style={roleColor ? { color: roleColor } : undefined}
            title={`${displayName(m.username)}${roleLabel ? ` (${roleLabel})` : ""}`}
          >
            {truncateName(m.username)}
          </span>
          {roleLabel && (
            <span className="text-[10px] px-1 py-0.5 rounded shrink-0" style={{ color: roleColor, backgroundColor: roleColor ? `${roleColor}20` : undefined }}>
              {roleLabel}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="w-60 bg-[var(--panel)] flex flex-col border-l border-[var(--accent-2)]/30">
      <div className="h-12 px-4 flex items-center border-b border-[var(--accent-2)]/30 justify-between">
        <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
          Members — {members.length}
        </span>
        <button
          onClick={() => setShowInvite(!showInvite)}
          className="text-[var(--muted)] hover:text-[var(--text)] text-xs"
          title="Invite / Join"
        >
          {showInvite ? "Close" : "Invite"}
        </button>
      </div>

      {showInvite && (
        <div className="p-3 border-b border-[var(--accent-2)]/30 space-y-2">
          {inviteCode && (
            <button
              onClick={copyInvite}
              className="w-full text-xs px-2 py-1.5 bg-[var(--panel-2)] text-[var(--text)] rounded hover:bg-[var(--accent-2)] transition-colors"
            >
              {copied ? "Copied!" : "Copy Invite Link"}
            </button>
          )}
          <div className="flex gap-1">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => { setJoinCode(e.target.value); setJoinError(""); }}
              placeholder="Paste invite code"
              className="flex-1 text-xs px-2 py-1.5 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none"
            />
            <button
              onClick={async () => {
                let code = joinCode.trim();
                const match = code.match(/\/join\/(.+)$/);
                if (match) code = match[1];
                if (!code) return;
                const res = await fetch("/api/servers/join", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ inviteCode: code }),
                });
                if (res.ok) {
                  setJoinCode("");
                  setShowInvite(false);
                  window.location.reload();
                } else {
                  const data = await res.json();
                  setJoinError(data.error || "Failed");
                }
              }}
              className="text-xs px-2 py-1.5 bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] transition-colors"
            >
              Join
            </button>
          </div>
          {joinError && <p className="text-xs text-[var(--danger)]">{joinError}</p>}
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2">
        {onlineMembers.length > 0 && (
          <>
            <div className="px-3 py-1">
              <span className="text-xs font-semibold text-[var(--muted)] uppercase">
                Online — {onlineMembers.length}
              </span>
            </div>
            {onlineMembers.map((m) => renderMember(m, true))}
          </>
        )}

        {offlineMembers.length > 0 && (
          <>
            <div className="px-3 py-1 mt-2">
              <span className="text-xs font-semibold text-[var(--muted)] uppercase">
                Offline — {offlineMembers.length}
              </span>
            </div>
            {offlineMembers.map((m) => renderMember(m, false))}
          </>
        )}
      </div>

      {/* Context menu for role management */}
      {contextMenu && (() => {
        const target = members.find((m) => m.id === contextMenu.memberId);
        if (!target) return null;
        return (
          <div
            className="fixed bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl py-1 z-50 min-w-[140px]"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 160), top: Math.min(contextMenu.y, window.innerHeight - 200) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1.5 text-xs text-[var(--muted)] border-b border-[var(--accent-2)]/20">
              {displayName(target.username)}
            </div>
            {target.role !== "admin" && (
              <button onClick={() => handleRoleChange(target.id, "admin")} className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-2)]">
                Make Admin
              </button>
            )}
            {target.role !== "mod" && (
              <button onClick={() => handleRoleChange(target.id, "mod")} className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-2)]">
                Make Moderator
              </button>
            )}
            {target.role !== "member" && target.role !== "owner" && (
              <button onClick={() => handleRoleChange(target.id, "member")} className="w-full text-left px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--panel-2)]">
                Remove Role
              </button>
            )}
            <div className="border-t border-[var(--accent-2)]/20 mt-1 pt-1">
              <button onClick={() => handleKick(target.id)} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-600/10">
                Kick Member
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
