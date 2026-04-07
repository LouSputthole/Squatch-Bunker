"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    if (!token) {
      setError("Missing reset token. Please request a new reset link.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      router.push("/login");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="w-full max-w-md p-8 bg-[var(--panel)] rounded-lg border border-[var(--accent-2)]">
        <div className="flex flex-col items-center mb-6">
          <img src="/Campfire-Logo.png" alt="Campfire" className="w-24 h-24 mb-3" />
          <h1 className="text-2xl font-bold text-[var(--text)] mb-1">
            New Password
          </h1>
          <p className="text-[var(--muted)] text-sm text-center">
            Choose a new password for your account
          </p>
        </div>

        {error && (
          <div className="p-3 mb-4 bg-[var(--danger)] text-[var(--text)] rounded text-sm">
            {error}
          </div>
        )}

        {!token ? (
          <div className="space-y-4">
            <p className="text-sm text-[var(--muted)] text-center">
              No reset token found. Please request a new reset link.
            </p>
            <Link
              href="/forgot-password"
              className="block text-center text-sm text-[var(--accent)] hover:underline"
            >
              Request reset link
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-[var(--muted)] mb-1">
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none focus:border-[var(--accent)]"
                required
                minLength={6}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm text-[var(--muted)] mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none focus:border-[var(--accent)]"
                required
                minLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors disabled:opacity-50 font-medium"
            >
              {loading ? "Updating..." : "Update Password"}
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

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
          <p className="text-[var(--muted)]">Loading...</p>
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
