"use client";

import { useEffect, useState } from "react";
import { parseTelemetryNotice, type TelemetryNotice } from "@/lib/telemetryProtocol";

const DISMISSED_KEY = "campfire-notice-dismissed";

function dismissedId(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/**
 * This instance's broadcast notice (CAMPFIRE_NOTICE via /api/notice), until
 * dismissed. Only the newest dismissed id is remembered: a new notice gets a
 * new id and shows again. `stacked` drops it below the guest-pass pill.
 */
export default function NoticeBanner({ stacked = false }: { stacked?: boolean }) {
  const [notice, setNotice] = useState<TelemetryNotice | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notice", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        // Re-validated here so a bad payload can never render a non-https link.
        const next = parseTelemetryNotice(data?.notice);
        if (!cancelled && next && next.id !== dismissedId()) setNotice(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!notice) return null;
  const { id } = notice;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, id);
    } catch {
      // Storage blocked: dismissed for this visit only.
    }
    setNotice(null);
  }

  return (
    <div
      role="status"
      className={`fixed ${stacked ? "top-12" : "top-2"} left-1/2 -translate-x-1/2 z-30 flex w-max max-w-[min(32rem,calc(100vw-1rem))] items-center gap-3 rounded-xl border border-[var(--accent)]/50 bg-[var(--panel)] px-4 py-2 text-xs text-[var(--text)] shadow-lg`}
    >
      <p className="min-w-0 break-words">{notice.text}</p>
      {notice.url && (
        <a
          href={notice.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded bg-[var(--accent)] px-2 py-1 font-semibold text-[var(--bg)] hover:opacity-90 transition-opacity"
        >
          {notice.urlLabel ?? "Learn more"}
        </a>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss announcement"
        className="shrink-0 rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"
      >
        ✕
      </button>
    </div>
  );
}
