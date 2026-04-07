"use client";
import { useState, useEffect } from "react";

interface LinkedMessage {
  id: string;
  content: string;
  author: { username: string; avatar?: string | null };
  channelId: string;
  createdAt: string;
}

interface Props {
  messageId: string;
  channelId: string;
  onJump: (messageId: string, channelId: string) => void;
}

export function MessageLinkEmbed({ messageId, channelId, onJump }: Props) {
  const [message, setMessage] = useState<LinkedMessage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`/api/messages/${messageId}`)
      .then(r => r.json())
      .then(d => { if (d.message) setMessage(d.message); else setFailed(true); })
      .catch(() => setFailed(true));
  }, [messageId]);

  if (failed) return null;
  if (!message) return null;

  return (
    <div
      onClick={() => onJump(messageId, channelId)}
      className="mt-1 border-l-2 border-[var(--accent-2)] pl-3 cursor-pointer hover:bg-white/5 rounded-r py-1 max-w-sm"
    >
      <div className="text-xs text-[var(--muted)] mb-0.5 flex items-center gap-1">
        <span className="font-medium text-[var(--text)]">{message.author.username}</span>
        <span>·</span>
        <span className="text-[var(--accent)] text-[10px]">Jump to message ↑</span>
      </div>
      <div className="text-sm text-[var(--text)] opacity-80 line-clamp-2">{message.content}</div>
    </div>
  );
}
