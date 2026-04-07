"use client";

import { useState } from "react";

interface Server {
  id: string;
  name: string;
  channels: { id: string; name: string }[];
  _count: { members: number };
}

interface ServerListProps {
  servers: Server[];
  activeServerId?: string;
  onServerSelect: (server: Server) => void;
  onServerCreated: (server: Server) => void;
  onServerJoined: (server: Server) => void;
}

export default function ServerList({
  servers,
  activeServerId,
  onServerSelect,
  onServerCreated,
  onServerJoined,
}: ServerListProps) {
  const [showPanel, setShowPanel] = useState<"create" | "join" | null>(null);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || loading) return;
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to create server");
        return;
      }

      onServerCreated(data.server);
      setNewName("");
      setShowPanel(null);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinCode.trim() || loading) return;
    setError("");
    setLoading(true);

    try {
      // Extract code from URL or use raw
      let code = joinCode.trim();
      const match = code.match(/\/join\/(.+)$/);
      if (match) code = match[1];

      const res = await fetch("/api/servers/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to join server");
        return;
      }

      onServerJoined(data.server);
      setJoinCode("");
      setShowPanel(null);
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="w-[72px] bg-[var(--bg)] flex flex-col items-center py-3 gap-2 border-r border-[var(--accent-2)]/30 shrink-0">
        {/* Campfire logo */}
        <img src="/campfire-logo.png" alt="Campfire" className="w-10 h-10 mb-1 opacity-90" title="Campfire" />
        <div className="w-8 h-[1px] bg-[var(--accent-2)]/30 mb-1" />

        {servers.map((server) => {
          const isActive = activeServerId === server.id;
          return (
            <div key={server.id} className="relative flex items-center">
              {isActive && (
                <div className="absolute -left-3 w-1 h-8 bg-white rounded-r-full" />
              )}
              <button
                onClick={() => onServerSelect(server)}
                className={`w-12 h-12 flex items-center justify-center text-lg font-bold text-white transition-all duration-200 ${
                  isActive
                    ? "bg-[var(--accent-2)] rounded-[16px]"
                    : "bg-[var(--panel-2)] rounded-[24px] hover:rounded-[16px] hover:bg-[var(--accent-2)]"
                }`}
                title={server.name}
              >
                {server.name[0].toUpperCase()}
              </button>
            </div>
          );
        })}

        <div className="w-8 h-[1px] bg-[var(--accent-2)]/30 my-1" />

        {/* Create server button */}
        <button
          onClick={() => { setShowPanel(showPanel === "create" ? null : "create"); setError(""); }}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl transition-all hover:rounded-xl ${
            showPanel === "create"
              ? "bg-[var(--accent-2)] text-[var(--text)] rounded-xl"
              : "bg-[var(--panel-2)] text-[var(--accent-2)] hover:bg-[var(--accent-2)] hover:text-[var(--text)]"
          }`}
          title="Create Server"
        >
          +
        </button>

        {/* Join server button */}
        <button
          onClick={() => { setShowPanel(showPanel === "join" ? null : "join"); setError(""); }}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center text-lg transition-all hover:rounded-xl ${
            showPanel === "join"
              ? "bg-[var(--accent-2)] text-[var(--text)] rounded-xl"
              : "bg-[var(--panel-2)] text-[var(--accent-2)] hover:bg-[var(--accent-2)] hover:text-[var(--text)]"
          }`}
          title="Join Server"
        >
          &#8618;
        </button>
      </div>

      {/* Slide-out panel for create/join */}
      {showPanel && (
        <div className="w-72 bg-[var(--panel)] border-r border-[var(--accent-2)]/30 flex flex-col shrink-0">
          <div className="h-12 px-4 flex items-center justify-between border-b border-[var(--accent-2)]/30">
            <h2 className="font-bold text-[var(--text)] text-sm">
              {showPanel === "create" ? "Create a Server" : "Join a Server"}
            </h2>
            <button
              onClick={() => setShowPanel(null)}
              className="text-[var(--muted)] hover:text-[var(--text)] text-lg"
            >
              &times;
            </button>
          </div>

          <div className="p-4">
            {error && (
              <div className="p-2 mb-3 bg-[var(--danger)] text-[var(--text)] rounded text-xs">
                {error}
              </div>
            )}

            {showPanel === "create" ? (
              <form onSubmit={handleCreate} className="space-y-3">
                <div>
                  <label className="block text-xs text-[var(--muted)] mb-1 uppercase tracking-wide">
                    Server Name
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="My Campfire"
                    className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none focus:border-[var(--accent)] text-sm"
                    autoFocus
                    required
                  />
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Your server is where you and your friends hang out. A #campfire channel will be created automatically.
                </p>
                <button
                  type="submit"
                  disabled={loading || !newName.trim()}
                  className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors disabled:opacity-50 font-medium text-sm"
                >
                  {loading ? "Creating..." : "Create Server"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleJoin} className="space-y-3">
                <div>
                  <label className="block text-xs text-[var(--muted)] mb-1 uppercase tracking-wide">
                    Invite Link or Code
                  </label>
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                    placeholder="Paste invite link or code"
                    className="w-full px-3 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none focus:border-[var(--accent)] text-sm"
                    autoFocus
                    required
                  />
                </div>
                <p className="text-xs text-[var(--muted)]">
                  Enter an invite link or code from a friend to join their server.
                </p>
                <button
                  type="submit"
                  disabled={loading || !joinCode.trim()}
                  className="w-full py-2 bg-[var(--accent-2)] text-[var(--text)] rounded hover:bg-[var(--accent)] hover:text-[var(--bg)] transition-colors disabled:opacity-50 font-medium text-sm"
                >
                  {loading ? "Joining..." : "Join Server"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
