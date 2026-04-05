"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [guestName, setGuestName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showGuest, setShowGuest] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        return;
      }

      router.push("/chat");
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleGuest(e: React.FormEvent) {
    e.preventDefault();
    if (!guestName.trim()) return;
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/guest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: guestName.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to join as guest");
        return;
      }

      router.push("/chat");
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <div className="w-full max-w-md p-8 bg-[var(--panel)] rounded-lg border border-[var(--accent-2)]">
        <div className="flex flex-col items-center mb-6">
          <img src="/campfire-logo.png" alt="Campfire" className="w-24 h-24 mb-3" />
          <h1 className="text-3xl font-bold text-[var(--text)] mb-1">
            Campfire
          </h1>
          <p className="text-[var(--muted)] text-sm">
            Welcome back to the fire
          </p>
        </div>

        {error && (
          <div className="p-3 mb-4 bg-[var(--danger)] text-[var(--text)] rounded text-sm">
            {error}
          </div>
        )}

        {!showGuest ? (
          <>
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
                />
              </div>

              <div>
                <label className="block text-sm text-[var(--muted)] mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none focus:border-[var(--accent)]"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors disabled:opacity-50 font-medium"
              >
                {loading ? "Entering the woods..." : "Log In"}
              </button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <div className="flex-1 h-px bg-[var(--accent-2)]/30" />
              <span className="text-xs text-[var(--muted)]">or</span>
              <div className="flex-1 h-px bg-[var(--accent-2)]/30" />
            </div>

            <button
              onClick={() => { setShowGuest(true); setError(""); }}
              className="w-full py-2 bg-[var(--panel-2)] text-[var(--text)] rounded border border-[var(--accent-2)]/50 hover:border-[var(--accent-2)] transition-colors font-medium"
            >
              Continue as Guest
            </button>

            <p className="mt-6 text-center text-sm text-[var(--muted)]">
              No account yet?{" "}
              <Link
                href="/register"
                className="text-[var(--accent)] hover:underline"
              >
                Register
              </Link>
            </p>
          </>
        ) : (
          <>
            <form onSubmit={handleGuest} className="space-y-4">
              <div>
                <label className="block text-sm text-[var(--muted)] mb-1">
                  Choose a username
                </label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="BigfootFan99"
                  className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none focus:border-[var(--accent)]"
                  required
                  minLength={2}
                  maxLength={24}
                  autoFocus
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  2-24 characters. A unique tag will be added automatically.
                </p>
              </div>

              <button
                type="submit"
                disabled={loading || !guestName.trim()}
                className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors disabled:opacity-50 font-medium"
              >
                {loading ? "Sneaking into the woods..." : "Enter the Woods"}
              </button>
            </form>

            <button
              onClick={() => { setShowGuest(false); setError(""); }}
              className="mt-4 w-full text-center text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors"
            >
              Back to login
            </button>
          </>
        )}
      </div>
    </div>
  );
}
