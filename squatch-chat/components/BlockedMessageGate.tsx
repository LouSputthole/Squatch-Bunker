"use client";

import { useState, type ReactNode } from "react";

interface BlockedMessageGateProps {
  blocked: boolean;
  children: ReactNode;
  className?: string;
}

export default function BlockedMessageGate({
  blocked,
  children,
  className = "px-2 py-2",
}: BlockedMessageGateProps) {
  const [revealed, setRevealed] = useState(false);

  if (!blocked || revealed) return <>{children}</>;

  return (
    <div
      className={`${className} flex items-center gap-2 text-xs text-[var(--muted)]`}
      role="note"
    >
      <span className="italic">Message from a blocked user hidden</span>
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="rounded px-2 py-0.5 font-medium text-[var(--accent-2)] hover:bg-[var(--accent-2)]/15 hover:text-[var(--accent)]"
      >
        Reveal
      </button>
    </div>
  );
}
