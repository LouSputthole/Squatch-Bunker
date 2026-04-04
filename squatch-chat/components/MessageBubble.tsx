"use client";

interface MessageBubbleProps {
  message: {
    id: string;
    content: string;
    createdAt: string;
    author: { id: string; username: string };
  };
  isOwn: boolean;
}

export default function MessageBubble({ message, isOwn }: MessageBubbleProps) {
  const time = new Date(message.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex gap-3 py-1 group hover:bg-[var(--panel)]/30 px-1 rounded ${isOwn ? "" : ""}`}>
      {/* Avatar placeholder */}
      <div className="w-10 h-10 rounded-full bg-[var(--accent-2)] flex items-center justify-center text-sm font-bold text-[var(--text)] shrink-0 mt-0.5">
        {message.author.username.slice(0, 2).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className={`font-semibold text-sm ${isOwn ? "text-[var(--accent)]" : "text-[var(--text)]"}`}>
            {message.author.username}
          </span>
          <span className="text-xs text-[var(--muted)]">{time}</span>
        </div>
        <p className="text-[var(--text)] text-sm break-words">{message.content}</p>
      </div>
    </div>
  );
}
