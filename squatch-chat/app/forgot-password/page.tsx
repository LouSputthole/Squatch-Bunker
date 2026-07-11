"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

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
      <div className="w-full max-w-md p-8 bg-[var(--panel)] rounded-lg border border-[var(--accent-2)]">
        <div className="flex flex-col items-center mb-6">
          <img src="/Campfire-Logo.png" alt="Campfire" className="w-24 h-24 mb-3" />
          <h1 className="text-2xl font-bold text-[var(--text)] mb-1">
            Reset Password
          </h1>
          <p className="text-[var(--muted)] text-sm text-center">
            Enter your email to receive a password reset link
          </p>
        </div>

        {submitted ? (
          <div className="space-y-4">
            <div
              className="p-4 bg-[var(--panel-2)] border border-[var(--accent-2)] rounded text-[var(--text)] text-sm"
            >
              Check your email for reset instructions.
            </div>
            <p className="text-xs text-[var(--muted)] p-3 bg-[var(--panel-2)] rounded border border-[var(--accent-2)]/40">
              Dev note: token would be emailed. For testing, check the database.
            </p>
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
              <label className="block text-sm text-[var(--muted)] mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none focus:border-[var(--accent)]"
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors disabled:opacity-50 font-medium"
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
