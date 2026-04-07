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
          <img src="/Campfire-Logo.png" alt="Campfire" className="w-24 h-24 mb-3" />
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
                <div className="mt-1 text-right">
                  <Link
                    href="/forgot-password"
                    className="text-xs text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
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

            <div className="flex flex-col gap-2">
              <a
                href="/api/auth/oauth/github"
                className="flex items-center justify-center gap-2 w-full py-2 bg-[#24292e] text-white rounded hover:bg-[#2f363d] transition-colors text-sm font-medium"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                Continue with GitHub
              </a>
              <a
                href="/api/auth/oauth/google"
                className="flex items-center justify-center gap-2 w-full py-2 bg-white text-[#333] rounded hover:bg-gray-100 transition-colors text-sm font-medium border border-gray-300"
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </a>
            </div>

            <div className="my-4 flex items-center gap-3">
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
