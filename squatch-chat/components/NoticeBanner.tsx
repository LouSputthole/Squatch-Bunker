"use client";

import { useEffect, useState } from "react";
import { parseTelemetryNotice, type TelemetryNotice } from "@/lib/telemetryProtocol";

const DISMISSED_KEY = "campfire-notice-dismissed";
// Chat stays open for days (a pinned tab, the Windows app in the tray) and nothing reloads it
// after a deploy, so the notice is re-read hourly and when the page comes back into view.
// ponytail: polling; a Socket.IO push would be instant once notices need to be.
const RECHECK_MS = 60 * 60 * 1000;

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
    let checkedAt = 0;
    function load() {
      checkedAt = Date.now();
      fetch("/api/notice", { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
        .then((data) => {
          if (cancelled) return;
          // Re-validated here so a bad payload can never render a non-https link.
          const next = parseTelemetryNotice(data?.notice);
          // A cleared notice disappears too; a failed check keeps what is shown.
          setNotice(next && next.id !== dismissedId() ? next : null);
        })
        .catch(() => {});
    }
    function recheck() {
      if (document.visibilityState === "visible" && Date.now() - checkedAt >= RECHECK_MS) load();
    }
    load();
    const timer = setInterval(recheck, RECHECK_MS / 12);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", recheck);
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
