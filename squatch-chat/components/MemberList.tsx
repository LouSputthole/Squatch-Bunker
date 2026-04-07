"use client";

import { useState, useEffect } from "react";
import { truncateName, displayName } from "@/lib/utils";
import Avatar from "@/components/Avatar";
import ProfileCard from "@/components/ProfileCard";

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
  joinedAt?: string;
  banned?: boolean;
  statusMessage?: string | null;
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
  dnd: "bg-red-500",
  invisible: "bg-gray-500",
};

function MoonIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="text-yellow-400 shrink-0">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function MemberList({ serverId, currentUserId, currentUserRole, onlineMemberIds, memberStatuses }: MemberListProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteCode, setInviteCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");
  const [contextMenu, setContextMenu] = useState<{ memberId: string; x: number; y: number } | null>(null);
  const [profileCard, setProfileCard] = useState<{ member: Member; x: number; y: number } | null>(null);

  useEffect(() => {
    fetch(`/api/servers/${serverId}/members`)
      .then((res) => res.json())
      .then((data) => {
        setMembers(data.members || []);
        setInviteCode(data.inviteCode || "");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [serverId]);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const bannedMembers = members.filter((m) => m.banned);
  const activeMembers = members.filter((m) => !m.banned);
  const onlineMembers = activeMembers.filter((m) => onlineMemberIds.has(m.id));
  const offlineMembers = activeMembers.filter((m) => !onlineMemberIds.has(m.id));

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

  async function handleBan(userId: string, ban: boolean) {
    setContextMenu(null);
    if (ban && !confirm("Ban this member?")) return;
    const res = await fetch(`/api/servers/${serverId}/members/${userId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banned: ban }),
    });
    if (res.ok) {
      setMembers((prev) => prev.map((m) => m.id === userId ? { ...m, banned: ban } : m));
    }
  }

  function renderMember(m: Member, online: boolean) {
    const roleColor = ROLE_COLORS[m.role || "member"];
    const roleLabel = ROLE_LABELS[m.role || "member"];
    const isSelf = m.id === currentUserId;

    return (
      <div
        key={m.id}
        className={`flex items-center gap-2 px-3 py-1 cursor-pointer hover:bg-[var(--panel-2)]/50 rounded ${online ? "" : "opacity-50"}`}
        onClick={(e) => setProfileCard({ member: m, x: e.clientX, y: e.clientY })}
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
          {(() => {
            const status = online ? (memberStatuses?.get(m.id) || "online") : "offline";
            if (status === "idle") return <MoonIcon />;
            return (
              <div className={`w-2 h-2 rounded-full shrink-0 ${
                online ? (STATUS_COLORS[status] || "bg-green-500") : "bg-[var(--muted)]"
              }`} />
            );
          })()}
          <span
            className={`text-sm truncate ${online ? "text-[var(--text)]" : "text-[var(--muted)]"}`}
            style={roleColor ? { color: roleColor } : undefined}
            title={`${displayName(m.username)}${roleLabel ? ` (${roleLabel})` : ""}${m.statusMessage ? `\n${m.statusMessage}` : ""}`}
          >
            {truncateName(m.username)}
          </span>
          {roleLabel && (
            <span className="text-[10px] px-1 py-0.5 rounded shrink-0" style={{ color: roleColor, backgroundColor: roleColor ? `${roleColor}20` : undefined }}>
              {roleLabel}
            </span>
          )}
          {m.statusMessage && (
            <span className="text-[10px] text-[var(--muted)] truncate ml-auto max-w-[80px] shrink-0" title={m.statusMessage}>
              {m.statusMessage}
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
          Members — {activeMembers.length}
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
        {loading && members.length === 0 ? (
          <div className="px-2 py-1 space-y-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1">
                <div className="w-8 h-8 rounded-full bg-[var(--accent-2)]/30 animate-pulse shrink-0" />
                <div
                  className="h-3 rounded bg-[var(--accent-2)]/30 animate-pulse"
                  style={{ width: `${48 + (i * 13) % 40}px` }}
                />
              </div>
            ))}
          </div>
        ) : (
          <>
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

            {canManage && bannedMembers.length > 0 && (
              <>
                <div className="px-3 py-1 mt-2">
                  <span className="text-xs font-semibold text-red-400/70 uppercase">
                    Banned — {bannedMembers.length}
                  </span>
                </div>
                {bannedMembers.map((m) => (
                  <div key={m.id} className="flex items-center gap-2 px-3 py-1 opacity-40 cursor-pointer hover:bg-[var(--panel-2)]/50 rounded" onContextMenu={(e) => { e.preventDefault(); setContextMenu({ memberId: m.id, x: e.clientX, y: e.clientY }); }}>
                    <Avatar username={m.username} avatarUrl={m.avatar} size={32} className="bg-red-900/30 text-red-400" />
                    <span className="text-sm truncate text-red-400">{truncateName(m.username)}</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Profile card on click */}
      {profileCard && (
        <ProfileCard
          username={profileCard.member.username}
          avatar={profileCard.member.avatar}
          role={profileCard.member.role}
          joinedAt={profileCard.member.joinedAt}
          anchorX={profileCard.x}
          anchorY={profileCard.y}
          onClose={() => setProfileCard(null)}
        />
      )}

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
              {target.banned ? (
                <button onClick={() => handleBan(target.id, false)} className="w-full text-left px-3 py-1.5 text-xs text-yellow-400 hover:bg-yellow-600/10">
                  Unban Member
                </button>
              ) : (
                <button onClick={() => handleBan(target.id, true)} className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-600/10">
                  Ban Member
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
