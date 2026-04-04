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
}

export default function ServerList({
  servers,
  activeServerId,
  onServerSelect,
  onServerCreated,
}: ServerListProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    const res = await fetch("/api/servers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });

    if (res.ok) {
      const { server } = await res.json();
      onServerCreated(server);
      setNewName("");
      setCreating(false);
    }
  }

  return (
    <div className="w-[72px] bg-[var(--bg)] flex flex-col items-center py-3 gap-2 border-r border-[var(--accent-2)]/30">
      {servers.map((server) => (
        <button
          key={server.id}
          onClick={() => onServerSelect(server)}
          className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold transition-all hover:rounded-xl ${
            activeServerId === server.id
              ? "bg-[var(--accent-2)] text-[var(--text)] rounded-xl"
              : "bg-[var(--panel-2)] text-[var(--muted)] hover:bg-[var(--accent-2)] hover:text-[var(--text)]"
          }`}
          title={server.name}
        >
          {server.name.slice(0, 2).toUpperCase()}
        </button>
      ))}

      <div className="w-8 h-[1px] bg-[var(--accent-2)]/30 my-1" />

      {creating ? (
        <form onSubmit={handleCreate} className="px-1">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Name"
            className="w-12 text-xs px-1 py-2 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded text-center focus:outline-none"
            autoFocus
            onBlur={() => {
              if (!newName.trim()) setCreating(false);
            }}
          />
        </form>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="w-12 h-12 rounded-2xl bg-[var(--panel-2)] text-[var(--accent-2)] hover:bg-[var(--accent-2)] hover:text-[var(--text)] hover:rounded-xl transition-all flex items-center justify-center text-2xl"
          title="Create Server"
        >
          +
        </button>
      )}
    </div>
  );
}
