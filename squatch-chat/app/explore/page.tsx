"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface PublicServer {
  id: string;
  name: string;
  icon?: string | null;
  description?: string | null;
  memberCount: number;
  inviteCode: string;
}

function ShimmerCard() {
  return (
    <div className="bg-[var(--panel)] rounded-xl p-4 border border-[var(--accent-2)]/20 animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-[var(--accent-2)]/20 shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-4 bg-[var(--accent-2)]/20 rounded w-3/4" />
          <div className="h-3 bg-[var(--accent-2)]/10 rounded w-1/3" />
        </div>
      </div>
      <div className="space-y-2 mb-4">
        <div className="h-3 bg-[var(--accent-2)]/10 rounded w-full" />
        <div className="h-3 bg-[var(--accent-2)]/10 rounded w-4/5" />
      </div>
      <div className="h-8 bg-[var(--accent-2)]/20 rounded-lg" />
    </div>
  );
}

function ServerCard({ server, onJoin, joining }: { server: PublicServer; onJoin: (s: PublicServer) => void; joining: boolean }) {
  const initials = server.name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="bg-[var(--panel)] rounded-xl p-4 border border-[var(--accent-2)]/20 hover:border-[var(--accent-2)]/50 transition-colors flex flex-col">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-[var(--accent-2)]/30 flex items-center justify-center text-lg font-bold text-[var(--text)]">
          {server.icon ? (
            <img src={server.icon} alt={server.name} className="w-full h-full object-cover" />
          ) : (
            initials
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[var(--text)] truncate">{server.name}</h3>
          <span className="inline-flex items-center gap-1 text-xs text-[var(--muted)]">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z" />
            </svg>
            {server.memberCount} {server.memberCount === 1 ? "member" : "members"}
          </span>
        </div>
      </div>

      {server.description && (
        <p className="text-sm text-[var(--muted)] mb-3 line-clamp-2 flex-1">
          {server.description}
        </p>
      )}
      {!server.description && <div className="flex-1" />}

      <button
        onClick={() => onJoin(server)}
        disabled={joining}
        className="mt-auto w-full py-2 rounded-lg bg-[var(--accent-2)]/20 text-[var(--accent-2)] hover:bg-[var(--accent-2)] hover:text-[var(--bg)] transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {joining ? "Joining..." : "Join"}
      </button>
    </div>
  );
}

export default function ExplorePage() {
  const router = useRouter();
  const [servers, setServers] = useState<PublicServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/servers/public")
      .then((r) => r.json())
      .then((data) => {
        setServers(data.servers ?? []);
      })
      .catch(() => setError("Failed to load servers"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = servers.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase())
  );

  async function handleJoin(server: PublicServer) {
    setJoiningId(server.id);
    setError("");
    try {
      const res = await fetch("/api/servers/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: server.inviteCode }),
      });

      if (res.status === 401) {
        router.push("/login?redirect=/explore");
        return;
      }

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to join server");
        return;
      }

      router.push("/chat");
    } catch {
      setError("Something went wrong");
    } finally {
      setJoiningId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Header */}
      <div className="border-b border-[var(--accent-2)]/20 bg-[var(--panel)]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center gap-4">
          <a
            href="/chat"
            className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--text)] transition-colors mr-2"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="M12 19l-7-7 7-7" />
            </svg>
            Back
          </a>
          <img src="/Campfire-Logo.png" alt="Campfire" className="w-9 h-9" />
          <h1 className="text-xl font-bold text-[var(--text)]">Explore Public Servers</h1>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Search bar */}
        <div className="mb-8">
          <div className="relative max-w-md">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search servers..."
              className="w-full pl-9 pr-4 py-2.5 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:border-[var(--accent-2)] text-sm"
            />
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ShimmerCard />
            <ShimmerCard />
            <ShimmerCard />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[var(--muted)]">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-4 opacity-40">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <p className="text-lg font-medium">No public servers found</p>
            {search && (
              <p className="text-sm mt-1">Try a different search term</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                onJoin={handleJoin}
                joining={joiningId === server.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
