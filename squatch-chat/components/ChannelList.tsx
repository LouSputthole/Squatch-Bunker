"use client";

import { useState } from "react";

interface Channel {
  id: string;
  name: string;
}

interface ChannelListProps {
  serverName: string;
  channels: Channel[];
  activeChannelId?: string;
  serverId: string;
  onChannelSelect: (channel: Channel) => void;
  onChannelCreated: (channel: Channel) => void;
}

export default function ChannelList({
  serverName,
  channels,
  activeChannelId,
  serverId,
  onChannelSelect,
  onChannelCreated,
}: ChannelListProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId, name: newName.trim() }),
    });

    if (res.ok) {
      const { channel } = await res.json();
      onChannelCreated(channel);
      setNewName("");
      setCreating(false);
    }
  }

  return (
    <div className="w-60 bg-[var(--panel)] flex flex-col border-r border-[var(--accent-2)]/30">
      <div className="h-12 px-4 flex items-center border-b border-[var(--accent-2)]/30">
        <h2 className="font-bold text-[var(--text)] truncate">{serverName}</h2>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-2 mb-1 flex items-center justify-between">
          <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wide">
            Text Channels
          </span>
          <button
            onClick={() => setCreating(true)}
            className="text-[var(--muted)] hover:text-[var(--text)] text-lg leading-none"
            title="Create Channel"
          >
            +
          </button>
        </div>

        {creating && (
          <form onSubmit={handleCreate} className="px-2 mb-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="channel-name"
              className="w-full text-sm px-2 py-1 bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)] rounded focus:outline-none"
              autoFocus
              onBlur={() => {
                if (!newName.trim()) setCreating(false);
              }}
            />
          </form>
        )}

        {channels.map((channel) => (
          <button
            key={channel.id}
            onClick={() => onChannelSelect(channel)}
            className={`w-full text-left px-2 py-1 mx-0 rounded text-sm flex items-center gap-1 ${
              activeChannelId === channel.id
                ? "bg-[var(--panel-2)] text-[var(--text)]"
                : "text-[var(--muted)] hover:bg-[var(--panel-2)]/50 hover:text-[var(--text)]"
            }`}
          >
            <span className="text-[var(--accent-2)]">#</span>
            {channel.name}
          </button>
        ))}
      </div>
    </div>
  );
}
