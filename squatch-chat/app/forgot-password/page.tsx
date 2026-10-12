"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  // null = still checking; false = this server has no email delivery configured
  const [resetEnabled, setResetEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled) setResetEnabled(data?.passwordResetEnabled !== false); })
      .catch(() => { if (!cancelled) setResetEnabled(true); });
    return () => { cancelled = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Swallow errors — always show success to avoid email enumeration
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="w-[calc(100%_-_2rem)] max-w-md p-8 bg-[var(--panel)] rounded-2xl border border-[var(--accent-2)]/40 shadow-2xl shadow-black/40">
        <div className="flex flex-col items-center mb-6">
          <Image src="/Campfire-Logo.png" alt="Campfire" width={96} height={96} className="mb-3" priority />
          <h1 className="text-2xl font-bold text-[var(--text)] mb-1">
            Reset Password
          </h1>
          <p className="text-[var(--muted)] text-sm text-center">
            Enter your email to receive a password reset link
          </p>
        </div>

        {resetEnabled === false ? (
          <div className="space-y-4">
            <div className="p-4 bg-[var(--panel-2)] border border-[var(--accent-2)]/50 rounded text-[var(--text)] text-sm">
              This Campfire server isn&apos;t set up to send email, so password reset links can&apos;t be delivered.
              Ask the server owner to reset your password or configure email delivery.
            </div>
            <Link href="/login" className="block text-center text-sm text-[var(--accent)] hover:underline mt-2">
              Back to login
            </Link>
          </div>
        ) : submitted ? (
          <div className="space-y-4">
            <div
              className="p-4 bg-[var(--panel-2)] border border-[var(--accent-2)] rounded text-[var(--text)] text-sm"
            >
              If an account exists for that email, reset instructions are on the way.
            </div>
            <Link
              href="/login"
              className="block text-center text-sm text-[var(--accent)] hover:underline mt-2"
            >
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="forgot-email" className="block text-sm text-[var(--muted)] mb-1">
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none focus:border-[var(--accent)]"
                required
                maxLength={254}
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[var(--accent-2)] text-white rounded-lg hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors disabled:opacity-50 font-semibold"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>

            <p className="text-center text-sm text-[var(--muted)]">
              Remember your password?{" "}
              <Link href="/login" className="text-[var(--accent)] hover:underline">
                Log in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
