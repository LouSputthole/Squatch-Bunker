"use client";

import { useState, useEffect } from "react";
import { getSocket } from "@/lib/socket";
import { truncateName, displayName } from "@/lib/utils";
import Avatar from "@/components/Avatar";

interface Member {
  id: string;
  username: string;
  avatar?: string | null;
}

interface MemberListProps {
  serverId: string;
  onlineMemberIds: Set<string>;
}

export default function MemberList({ serverId, onlineMemberIds }: MemberListProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteCode, setInviteCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState("");

  useEffect(() => {
    fetch(`/api/servers/${serverId}/members`)
      .then((res) => res.json())
      .then((data) => {
        setMembers(data.members || []);
        setInviteCode(data.inviteCode || "");
      });
  }, [serverId]);

  const onlineMembers = members.filter((m) => onlineMemberIds.has(m.id));
  const offlineMembers = members.filter((m) => !onlineMemberIds.has(m.id));

  function copyInvite() {
    const link = `${window.location.origin}/join/${inviteCode}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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
                // Extract code from URL or use raw code
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
            {onlineMembers.map((m) => (
              <div key={m.id} className="flex items-center gap-2 px-3 py-1">
                <Avatar username={m.username} avatarUrl={m.avatar} size={32} className="bg-[var(--accent-2)] text-[var(--text)]" />
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-sm text-[var(--text)]" title={displayName(m.username)}>
                    {truncateName(m.username)}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}

        {offlineMembers.length > 0 && (
          <>
            <div className="px-3 py-1 mt-2">
              <span className="text-xs font-semibold text-[var(--muted)] uppercase">
                Offline — {offlineMembers.length}
              </span>
            </div>
            {offlineMembers.map((m) => (
              <div key={m.id} className="flex items-center gap-2 px-3 py-1 opacity-50">
                <Avatar username={m.username} avatarUrl={m.avatar} size={32} className="bg-[var(--panel-2)] text-[var(--muted)]" />
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full bg-[var(--muted)]" />
                  <span className="text-sm text-[var(--muted)]" title={displayName(m.username)}>
                    {truncateName(m.username)}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
