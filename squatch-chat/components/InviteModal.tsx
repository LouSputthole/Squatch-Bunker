"use client";

import { useState, useEffect, useCallback } from "react";

interface InviteModalProps {
  serverName: string;
  serverIcon?: string | null;
  memberCount: number;
  serverId: string;
  inviteCode: string;
  inviteExpiresAt?: string | null;
  inviteMaxUses?: number | null;
  inviteUseCount?: number;
  inviteRevokedAt?: string | null;
  isOwner: boolean;
  onInviteUpdated?: (invite: {
    inviteCode: string;
    inviteExpiresAt: string | null;
    inviteMaxUses: number | null;
    inviteUseCount: number;
    inviteRevokedAt: string | null;
  }) => void;
  onClose: () => void;
}

export default function InviteModal({
  serverName,
  serverIcon,
  memberCount,
  serverId,
  inviteCode: initialInviteCode,
  inviteExpiresAt: initialInviteExpiresAt,
  inviteMaxUses: initialInviteMaxUses,
  inviteUseCount: initialInviteUseCount = 0,
  inviteRevokedAt: initialInviteRevokedAt,
  isOwner,
  onInviteUpdated,
  onClose,
}: InviteModalProps) {
  const [origin, setOrigin] = useState("");
  const [inviteCode, setInviteCode] = useState(initialInviteCode);
  const [inviteExpiresAt, setInviteExpiresAt] = useState(initialInviteExpiresAt ?? null);
  const [inviteMaxUses, setInviteMaxUses] = useState(initialInviteMaxUses ?? null);
  const [inviteUseCount, setInviteUseCount] = useState(initialInviteUseCount);
  const [inviteRevokedAt, setInviteRevokedAt] = useState(initialInviteRevokedAt ?? null);
  const [expiryPreset, setExpiryPreset] = useState(
    initialInviteExpiresAt ? "keep" : "never",
  );
  const [expired, setExpired] = useState(false);
  const [maxUsesInput, setMaxUsesInput] = useState(
    initialInviteMaxUses?.toString() ?? "",
  );
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [regenError, setRegenError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setOrigin(window.location.origin), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const isExpired =
        inviteExpiresAt !== null &&
        new Date(inviteExpiresAt).getTime() <= Date.now();
      setExpired(isExpired);
      if (isExpired) {
        setExpiryPreset((current) => (current === "keep" ? "never" : current));
      }
    };
    const immediate = window.setTimeout(refresh, 0);
    const remainingMs = inviteExpiresAt
      ? new Date(inviteExpiresAt).getTime() - Date.now()
      : -1;
    const expiryTimer =
      remainingMs > 0 ? window.setTimeout(refresh, remainingMs + 25) : undefined;
    return () => {
      window.clearTimeout(immediate);
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
    };
  }, [inviteExpiresAt]);

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
  const exhausted =
    inviteMaxUses !== null && inviteUseCount >= inviteMaxUses;
  const inviteStatus = inviteRevokedAt
    ? "Revoked"
    : expired
      ? "Expired"
      : exhausted
        ? "Use limit reached"
        : "Active";
  const inviteActive = inviteStatus === "Active";
  const remainingUses =
    inviteMaxUses === null ? null : Math.max(0, inviteMaxUses - inviteUseCount);

  function applyInviteUpdate(server: {
    inviteCode: string;
    inviteExpiresAt: string | null;
    inviteMaxUses: number | null;
    inviteUseCount: number;
    inviteRevokedAt: string | null;
  }) {
    const next = {
      inviteCode: server.inviteCode,
      inviteExpiresAt: server.inviteExpiresAt ?? null,
      inviteMaxUses: server.inviteMaxUses ?? null,
      inviteUseCount: server.inviteUseCount ?? 0,
      inviteRevokedAt: server.inviteRevokedAt ?? null,
    };
    setInviteCode(next.inviteCode);
    setInviteExpiresAt(next.inviteExpiresAt);
    setInviteMaxUses(next.inviteMaxUses);
    setInviteUseCount(next.inviteUseCount);
    setInviteRevokedAt(next.inviteRevokedAt);
    setMaxUsesInput(next.inviteMaxUses?.toString() ?? "");
    setExpiryPreset(
      next.inviteExpiresAt &&
        new Date(next.inviteExpiresAt).getTime() > Date.now()
        ? "keep"
        : "never",
    );
    onInviteUpdated?.(next);
  }

  async function handleCopy() {
    if (!inviteActive) return;
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
    const parsedMaxUses =
      maxUsesInput.trim() === "" ? null : Number(maxUsesInput);
    if (
      parsedMaxUses !== null &&
      (!Number.isInteger(parsedMaxUses) ||
        parsedMaxUses < 1 ||
        parsedMaxUses > 100_000)
    ) {
      setRegenError("Use limit must be a whole number from 1 to 100,000");
      return;
    }

    const expirySeconds: Record<string, number | null | undefined> = {
      keep: undefined,
      never: null,
      hour: 60 * 60,
      day: 24 * 60 * 60,
      week: 7 * 24 * 60 * 60,
      month: 30 * 24 * 60 * 60,
    };
    const payload: {
      regenerateInvite: true;
      inviteMaxUses: number | null;
      inviteExpiresInSeconds?: number | null;
    } = {
      regenerateInvite: true,
      inviteMaxUses: parsedMaxUses,
    };
    if (expirySeconds[expiryPreset] !== undefined) {
      payload.inviteExpiresInSeconds = expirySeconds[expiryPreset];
    }

    setRegenerating(true);
    setRegenError("");
    try {
      const res = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        applyInviteUpdate(data.server);
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

  async function handleRevoke() {
    if (revoking || !inviteActive) return;
    if (!window.confirm("Revoke this invite link? Existing members keep access.")) {
      return;
    }

    setRevoking(true);
    setRegenError("");
    try {
      const res = await fetch(`/api/servers/${serverId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revokeInvite: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegenError(data.error || "Failed to revoke invite");
        return;
      }
      applyInviteUpdate(data.server);
    } catch {
      setRegenError("Something went wrong");
    } finally {
      setRevoking(false);
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
                // eslint-disable-next-line @next/next/no-img-element -- server icons may be user-hosted, data, or blob URLs
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
                disabled={!inviteActive}
                className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  copied
                    ? "bg-green-600/30 text-green-400 border border-green-600/40"
                    : "bg-[var(--accent-2)] text-[var(--text)] hover:bg-[var(--accent)] border border-transparent"
                }`}
              >
                {copied ? "Copied!" : "Copy Link"}
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--accent-2)]/20 bg-[var(--panel-2)]/40 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`text-xs font-semibold ${
                  inviteActive ? "text-green-400" : "text-[var(--danger)]"
                }`}
              >
                {inviteStatus}
              </span>
              <span className="text-xs text-[var(--muted)]">
                {inviteMaxUses === null
                  ? `${inviteUseCount} uses`
                  : `${inviteUseCount}/${inviteMaxUses} uses`}
              </span>
            </div>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {inviteExpiresAt
                ? `Expires ${new Date(inviteExpiresAt).toLocaleString()}`
                : "Never expires"}
              {remainingUses !== null && ` · ${remainingUses} remaining`}
            </p>
          </div>

          {isOwner && (
            <div className="pt-1 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs text-[var(--muted)]">
                  New link expires
                  <select
                    value={expiryPreset}
                    onChange={(e) => setExpiryPreset(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel-2)] px-2 py-2 text-sm text-[var(--text)]"
                  >
                    {inviteExpiresAt && <option value="keep">Keep current</option>}
                    <option value="never">Never</option>
                    <option value="hour">1 hour</option>
                    <option value="day">1 day</option>
                    <option value="week">7 days</option>
                    <option value="month">30 days</option>
                  </select>
                </label>
                <label className="text-xs text-[var(--muted)]">
                  Maximum uses
                  <input
                    type="number"
                    min={1}
                    max={100000}
                    step={1}
                    value={maxUsesInput}
                    onChange={(e) => setMaxUsesInput(e.target.value)}
                    placeholder="Unlimited"
                    className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel-2)] px-2 py-2 text-sm text-[var(--text)]"
                  />
                </label>
              </div>
              {regenError && (
                <p className="text-xs text-[var(--danger)] mb-2">{regenError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleRegenerate}
                  disabled={regenerating || revoking}
                  className="flex-1 px-3 py-2 text-sm text-[var(--text)] bg-[var(--accent-2)]/30 border border-[var(--accent-2)]/40 rounded-lg hover:bg-[var(--accent-2)]/50 transition-colors disabled:opacity-40"
                >
                  {regenerating
                    ? "Generating..."
                    : inviteActive
                      ? "Generate New Link"
                      : "Restore With New Link"}
                </button>
                <button
                  onClick={handleRevoke}
                  disabled={!inviteActive || regenerating || revoking}
                  className="px-3 py-2 text-sm text-[var(--danger)] bg-[var(--panel-2)]/50 border border-[var(--danger)]/30 rounded-lg hover:bg-[var(--danger)]/10 transition-colors disabled:opacity-40"
                >
                  {revoking ? "Revoking..." : "Revoke"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
