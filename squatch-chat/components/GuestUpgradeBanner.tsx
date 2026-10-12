"use client";

import { useState } from "react";
import { displayName } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { useEscape } from "@/hooks/useEscape";

interface GuestUpgradeBannerProps {
  username: string;
  guestExpiresAt?: string | null;
  onUpgraded: (user: { username: string; email: string }) => void;
}

function expiresLabel(guestExpiresAt?: string | null): string {
  if (!guestExpiresAt) return "Guest pass";
  const hours = Math.max(0, Math.round((new Date(guestExpiresAt).getTime() - Date.now()) / 3_600_000));
  return hours <= 1 ? "Guest pass: under 1h left" : `Guest pass: ~${hours}h left`;
}

/** Slim banner for guests with a modal that converts the guest into a real account (POST /api/auth/upgrade). */
export default function GuestUpgradeBanner({ username, guestExpiresAt, onUpgraded }: GuestUpgradeBannerProps) {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState(() => displayName(username));
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEscape(() => setOpen(false), open);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/auth/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, username: name, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Couldn't save your account");
        return;
      }
      setOpen(false);
      toast("Your account is saved — welcome to the camp for good.", "success");
      onUpgraded({ username: data.user?.username ?? name, email: data.user?.email ?? email });
    } catch {
      setError("Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  if (dismissed && !open) return null;

  return (
    <>
      <div className="fixed top-2 left-1/2 -translate-x-1/2 z-30 flex max-w-[calc(100vw-1rem)] items-center gap-3 rounded-full px-4 py-1.5 bg-[var(--accent-2)] text-white text-xs shadow-lg">
        <span className="truncate">{expiresLabel(guestExpiresAt)}</span>
        <button onClick={() => setOpen(true)} className="shrink-0 rounded bg-white/20 px-2 py-0.5 font-semibold hover:bg-white/30 transition-colors">
          Keep my account
        </button>
        <button onClick={() => setDismissed(true)} aria-label="Dismiss guest notice" className="shrink-0 opacity-80 hover:opacity-100">
          ✕
        </button>
      </div>

      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="guest-upgrade-title" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-[var(--accent-2)]/40 bg-[var(--panel)] p-6 shadow-2xl space-y-4">
            <div>
              <h2 id="guest-upgrade-title" className="text-lg font-bold text-[var(--text)]">Keep your seat by the fire</h2>
              <p className="text-xs text-[var(--muted)] mt-1">Add an email and password to turn this guest pass into a real account. Your camps and messages come with you.</p>
            </div>
            {error && <div role="alert" className="rounded bg-[var(--danger)] p-2 text-sm text-[var(--text)]">{error}</div>}
            <label className="block text-sm text-[var(--muted)]">
              Username
              <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={32} autoComplete="username" className="mt-1 w-full rounded border border-[var(--accent-2)]/60 bg-[var(--panel-2)] px-3 py-2 text-[var(--text)] focus:border-[var(--accent)] focus:outline-none" />
            </label>
            <label className="block text-sm text-[var(--muted)]">
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus className="mt-1 w-full rounded border border-[var(--accent-2)]/60 bg-[var(--panel-2)] px-3 py-2 text-[var(--text)] focus:border-[var(--accent)] focus:outline-none" />
            </label>
            <label className="block text-sm text-[var(--muted)]">
              Password
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" className="mt-1 w-full rounded border border-[var(--accent-2)]/60 bg-[var(--panel-2)] px-3 py-2 text-[var(--text)] focus:border-[var(--accent)] focus:outline-none" />
            </label>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-lg py-2 text-sm text-[var(--muted)] hover:text-[var(--text)]">Not now</button>
              <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-[var(--accent-2)] py-2 text-sm font-semibold text-white hover:bg-[var(--accent)] hover:text-[var(--bg)] disabled:opacity-50 transition-colors">
                {saving ? "Saving..." : "Save account"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
