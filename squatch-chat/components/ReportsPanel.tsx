"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { toast, toastResponseError } from "@/lib/toast";

export interface ServerReport {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  reporter: { id: string; username: string };
  target: { id: string; username: string };
  message: { id: string; channelId: string; channelName: string; snippet: string; createdAt: string };
}

interface ReportsPanelProps {
  serverId: string;
  /** Hidden panels stay mounted so the parent can show the open count as a badge. */
  visible: boolean;
  /** Open-report count, or null when the viewer can't review reports here (a state setter). */
  onOpenCountChange?: Dispatch<SetStateAction<number | null>>;
  onJumpToMessage?: (channelId: string, messageId: string) => void;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Ranger Desk: open reports on messages this moderator can see in this server. */
export default function ReportsPanel({ serverId, visible, onOpenCountChange, onJumpToMessage }: ReportsPanelProps) {
  const [reports, setReports] = useState<ServerReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pending, setPending] = useState<Set<string>>(new Set());

  const fetchReports = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    fetch(`/api/servers/${serverId}/reports`)
      .then(async (res) => {
        if (res.status === 403) {
          setReports([]);
          onOpenCountChange?.(null);
          return;
        }
        if (!res.ok) throw new Error(`reports ${res.status}`);
        const data = await res.json();
        setReports(data.reports || []);
        onOpenCountChange?.(data.openCount ?? 0);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [serverId, onOpenCountChange]);

  useEffect(() => {
    const timer = setTimeout(fetchReports, 0);
    return () => clearTimeout(timer);
  }, [fetchReports]);

  async function close(report: ServerReport, status: "resolved" | "dismissed") {
    const fallback = status === "resolved" ? "Couldn't resolve the report" : "Couldn't dismiss the report";
    setPending((prev) => new Set(prev).add(report.id));
    try {
      const res = await fetch(`/api/servers/${serverId}/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      // 409 = another ranger already handled it; either way it leaves the queue.
      if (!res.ok && res.status !== 409) {
        await toastResponseError(res, fallback);
        return;
      }
      // Functional updates: two reports closed concurrently must not resurrect each other.
      setReports((prev) => prev.filter((r) => r.id !== report.id));
      onOpenCountChange?.((count) => (count === null ? count : Math.max(0, count - 1)));
      toast(status === "resolved" ? "Report resolved" : "Report dismissed", "success");
    } catch {
      toast(fallback, "error");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(report.id);
        return next;
      });
    }
  }

  if (!visible) return null;

  if (loading) {
    return <div className="flex justify-center py-12 text-sm text-[var(--muted)]">Loading reports...</div>;
  }
  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-sm text-[var(--muted)]" role="alert">
        Couldn&apos;t load reports.
        <button onClick={fetchReports} className="text-xs px-3 py-1 rounded bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)] transition-colors">
          Retry
        </button>
      </div>
    );
  }
  if (reports.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-12 text-sm text-[var(--muted)]">
        <span aria-hidden="true" className="text-2xl">🏕️</span>
        No open reports — the camp is calm
      </div>
    );
  }

  return (
    <ul className="space-y-2" aria-label="Open reports">
      {reports.map((report) => {
        const busy = pending.has(report.id);
        return (
          <li key={report.id} className="rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel-2)]/40 px-4 py-3">
            <div className="flex items-baseline gap-2 flex-wrap text-xs">
              <span className="font-semibold text-[var(--text)]">{report.reporter.username}</span>
              <span className="text-[var(--muted)]">reported</span>
              <span className="font-semibold text-[var(--danger)]">{report.target.username}</span>
              <span className="ml-auto text-[var(--muted)]">{formatWhen(report.createdAt)}</span>
            </div>
            <p className="mt-1.5 text-sm text-[var(--text)] whitespace-pre-wrap break-words">{report.reason}</p>
            <blockquote className="mt-2 border-l-2 border-[var(--accent-2)] pl-3 text-xs text-[var(--muted)]">
              <span className="block mb-0.5">
                #{report.message.channelName} · {formatWhen(report.message.createdAt)}
              </span>
              <span className="text-[var(--text)] break-words">{report.message.snippet || "(no text)"}</span>
            </blockquote>
            <div className="mt-2.5 flex items-center gap-1.5">
              {onJumpToMessage && (
                <button
                  onClick={() => onJumpToMessage(report.message.channelId, report.message.id)}
                  className="text-xs px-2 py-1 rounded text-[var(--accent)] hover:underline"
                >
                  Jump to message
                </button>
              )}
              <button
                disabled={busy}
                onClick={() => void close(report, "dismissed")}
                className="ml-auto text-xs px-2 py-1 rounded bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--accent-2)]/40 transition-colors disabled:opacity-50"
              >
                Dismiss
              </button>
              <button
                disabled={busy}
                onClick={() => void close(report, "resolved")}
                className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-[var(--bg)] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                Resolve
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
