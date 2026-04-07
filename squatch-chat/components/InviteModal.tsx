"use client";

import { useState, useEffect, useCallback } from "react";

interface InviteModalProps {
  serverName: string;
  serverIcon?: string | null;
  memberCount: number;
  serverId: string;
  inviteCode: string;
  isOwner: boolean;
  onClose: () => void;
}

export default function InviteModal({
  serverName,
  serverIcon,
  memberCount,
  serverId,
  inviteCode: initialInviteCode,
  isOwner,
  onClose,
}: InviteModalProps) {
  const [origin, setOrigin] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const inviteUrl = origin ? `${origin}/join/${inviteCode}` : `/join/${inviteCode}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the input
    }
  }

  async function handleRegenerate() {
    if (regenerating) return;
    setRegenerating(true);
    setRegenError("");
    try {
      const res = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerateInvite: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setInviteCode(data.server.inviteCode);
      } else {
        const data = await res.json();
        setRegenError(data.error || "Failed to regenerate");
      }
    } catch {
      setRegenError("Something went wrong");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[450px] mx-4 bg-[var(--panel)] rounded-xl border border-[var(--accent-2)]/30 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative p-6 pb-4 border-b border-[var(--accent-2)]/20">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-[var(--muted)] hover:text-[var(--text)] text-2xl leading-none transition-colors w-8 h-8 flex items-center justify-center rounded hover:bg-[var(--panel-2)]/50"
            aria-label="Close"
          >
            &times;
          </button>

          <div className="flex items-center gap-4">
            {/* Server icon */}
            <div className="shrink-0">
              {serverIcon ? (
                <img
                  src={serverIcon}
                  alt={serverName}
                  className="w-16 h-16 rounded-2xl object-cover"
                />
              ) : (
                <div
                  className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold text-[var(--text)]"
                  style={{ background: "var(--accent-2)" }}
                >
                  {serverName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* Server info */}
            <div className="min-w-0">
              <h2 className="text-xl font-bold text-[var(--text)] truncate">{serverName}</h2>
              <p className="text-sm text-[var(--muted)] mt-0.5">
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[var(--muted)] uppercase tracking-wide mb-2">
              Invite Link
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                className="flex-1 min-w-0 text-sm px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/30 rounded-lg focus:outline-none focus:border-[var(--accent-2)] cursor-text select-all"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={handleCopy}
                className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                  copied
                    ? "bg-green-600/30 text-green-400 border border-green-600/40"
                    : "bg-[var(--accent-2)] text-[var(--text)] hover:bg-[var(--accent)] border border-transparent"
                }`}
              >
                {copied ? "Copied!" : "Copy Link"}
              </button>
            </div>
          </div>

          {isOwner && (
            <div className="pt-1">
              {regenError && (
                <p className="text-xs text-[var(--danger)] mb-2">{regenError}</p>
              )}
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="w-full px-3 py-2 text-sm text-[var(--muted)] bg-[var(--panel-2)]/50 border border-[var(--accent-2)]/20 rounded-lg hover:text-[var(--text)] hover:border-[var(--accent-2)]/50 transition-colors disabled:opacity-40"
              >
                {regenerating ? "Regenerating..." : "Regenerate Link"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
