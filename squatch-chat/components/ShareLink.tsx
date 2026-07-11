"use client";

import { useState } from "react";

export default function ShareLink() {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const url = typeof window !== "undefined" ? window.location.origin : "";

  function copy() {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--accent-2)]/30 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
        title="Invite others"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 bg-[var(--panel)] border border-[var(--accent-2)]/30 rounded-lg shadow-xl p-3 w-72 z-50">
          <p className="text-xs text-[var(--muted)] mb-2">Share this link so others can join:</p>
          <div className="flex gap-1.5">
            <input
              readOnly
              value={url}
              className="flex-1 bg-[var(--bg)] border border-[var(--accent-2)]/30 rounded px-2 py-1.5 text-xs text-[var(--text)] select-all"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button
              onClick={copy}
              className="px-2.5 py-1.5 rounded text-xs font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity shrink-0"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <p className="text-[10px] text-[var(--muted)] mt-2">
            Others need to be on the same network, or use a tunnel for internet access.
          </p>
        </div>
      )}
    </div>
  );
}
