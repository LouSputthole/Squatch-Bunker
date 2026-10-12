"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { disconnectSocket } from "@/lib/socket";

interface DeleteAccountSettingsProps {
  username: string;
  /** Asks for the current password too (not for guests or GitHub/Google-only accounts). */
  hasPassword: boolean;
}

/** Settings -> Account -> Delete account (DELETE /api/auth/me, lib/accountDeletion.ts). */
export function DeleteAccountSettings({ username, hasPassword }: DeleteAccountSettingsProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const ready = confirmName.trim() === username && (!hasPassword || password.length > 0);

  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || deleting) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch("/api/auth/me", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: confirmName.trim(), ...(hasPassword ? { password } : {}) }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(typeof data?.error === "string" ? data.error : "Couldn't delete your account");
        setDeleting(false);
        return;
      }
      // Same exit as logging out (hooks/useAuth.ts); the session cookie is already cleared.
      disconnectSocket();
      router.push("/login");
    } catch {
      setError("Couldn't delete your account");
      setDeleting(false);
    }
  }

  const inputClass =
    "w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/50 rounded text-sm focus:outline-none focus:border-[var(--danger)]";

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[var(--text)]">Delete account</p>
          <p className="text-xs text-[var(--muted)]">Permanently delete your account and sign out everywhere.</p>
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="shrink-0 px-4 py-2 bg-[var(--danger)]/15 text-[var(--danger)] text-sm font-semibold rounded hover:bg-[var(--danger)] hover:text-white transition-colors"
          >
            Delete account
          </button>
        )}
      </div>

      {open && (
        <form onSubmit={deleteAccount} className="mt-3 space-y-3 rounded-lg border border-[var(--danger)]/60 p-3">
          <div className="space-y-1 text-xs text-[var(--muted)]">
            <p>
              This deletes your email, password, profile, sign-in links, camp memberships, friends, blocks, notes,
              bookmarks, Camp Journal, reactions, votes, RSVPs, scheduled messages, and notifications. It can&apos;t
              be undone.
            </p>
            <p>
              Messages you posted in camps, your direct messages, and polls and gatherings you created stay where
              other people can see them, shown as &ldquo;Deleted user&rdquo;. Delete any camp messages you don&apos;t
              want to leave behind first. If you own camps, delete them first.
            </p>
          </div>
          <div>
            <label htmlFor="delete-account-username" className="block text-xs text-[var(--muted)] mb-1">
              Type <strong className="text-[var(--text)]">{username}</strong> to confirm
            </label>
            <input
              id="delete-account-username"
              type="text"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              autoComplete="off"
              className={inputClass}
            />
          </div>
          {hasPassword && (
            <div>
              <label htmlFor="delete-account-password" className="block text-xs text-[var(--muted)] mb-1">
                Current password
              </label>
              <input
                id="delete-account-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className={inputClass}
              />
            </div>
          )}
          {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); setConfirmName(""); setPassword(""); setError(""); }}
              className="px-3 py-2 text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!ready || deleting}
              className="px-4 py-2 bg-[var(--danger)] text-white text-sm font-semibold rounded hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete my account"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
