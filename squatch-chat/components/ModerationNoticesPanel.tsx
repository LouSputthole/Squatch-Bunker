"use client";

import { useCallback, useEffect, useState } from "react";
import PromptDialog, { type PromptDialogRequest } from "@/components/PromptDialog";
import { useEscape } from "@/hooks/useEscape";
import { REPORT_ACTION_LABELS, REPORT_ACTION_NOTICES, type ReportAction } from "@/lib/reportLabels";
import { toast, toastResponseError } from "@/lib/toast";

interface Notice {
  reportId: string;
  serverName: string | null;
  channelName: string | null;
  action: string;
  note: string | null;
  resolvedAt: string;
  canAppeal: boolean;
  appeal: {
    id: string;
    status: string;
    reason: string;
    createdAt: string;
    decisionNote: string | null;
    decidedAt: string | null;
  } | null;
}

interface ModerationNoticesPanelProps {
  open: boolean;
  onClose: () => void;
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** The member's side of Ranger Desk: what moderation did, and the one appeal per action. */
export default function ModerationNoticesPanel({ open, onClose }: ModerationNoticesPanelProps) {
  const [notices, setNotices] = useState<Notice[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [dialog, setDialog] = useState<PromptDialogRequest | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    fetch("/api/reports/notices")
      .then(async (res) => {
        if (!res.ok) throw new Error(`notices ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setNotices(data.notices || []);
          setLoadError(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancel: (() => void) | undefined;
    const timer = setTimeout(() => {
      cancel = load();
    }, 0);
    return () => {
      clearTimeout(timer);
      cancel?.();
    };
  }, [open, load]);

  useEscape(onClose, open && !dialog);

  if (!open) return null;

  function askAppeal(notice: Notice) {
    setDialog({
      title: "Appeal this decision",
      message: "A different moderator of that camp reviews your appeal. Say what you think they got wrong.",
      mode: "textarea",
      label: "Your appeal",
      placeholder: "At least 10 characters",
      minLength: 10,
      maxLength: 1000,
      confirmLabel: "Send appeal",
      onConfirm: async (reason) => {
        try {
          const res = await fetch(`/api/reports/${notice.reportId}/appeal`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: reason.trim() }),
          });
          if (!res.ok) {
            await toastResponseError(res, "Couldn't send the appeal");
            return;
          }
          const data = await res.json();
          setNotices((prev) => (prev ?? []).map((n) => (n.reportId === notice.reportId ? { ...n, canAppeal: false, appeal: data.appeal } : n)));
          setDialog(null);
          toast("Appeal sent", "success");
        } catch {
          toast("Couldn't send the appeal", "error");
        }
      },
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
      aria-label="Moderation notices"
    >
      <div
        className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-xl shadow-2xl border border-[var(--accent-2)]/30 overflow-hidden"
        style={{ background: "var(--panel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--accent-2)]/30" style={{ background: "var(--bg)" }}>
          <h2 className="text-sm font-semibold text-[var(--text)]">Moderation notices</h2>
          <button onClick={onClose} className="text-xs px-2 py-1 rounded hover:bg-[var(--panel-2)] transition-colors text-[var(--muted)]" aria-label="Close moderation notices">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loadError ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]" role="alert">Couldn&apos;t load your notices.</p>
          ) : notices === null ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">Loading…</p>
          ) : notices.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--muted)]">No moderation actions on your account. 🏕️</p>
          ) : (
            <ul className="space-y-2">
              {notices.map((notice) => {
                const action = notice.action as ReportAction;
                return (
                  <li key={notice.reportId} className="rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel-2)]/40 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2 text-xs">
                      <span className="font-semibold text-[var(--text)]">{REPORT_ACTION_LABELS[action] ?? notice.action}</span>
                      <span className="text-[var(--muted)]">{notice.serverName ?? "a camp"}{notice.channelName ? ` · #${notice.channelName}` : ""}</span>
                      <span className="ml-auto text-[var(--muted)]">{formatWhen(notice.resolvedAt)}</span>
                    </div>
                    <p className="mt-1 text-[var(--text)]">
                      {action in REPORT_ACTION_NOTICES ? REPORT_ACTION_NOTICES[action as Exclude<ReportAction, "none">] : ""}
                      {notice.note ? ` Reason: ${notice.note}` : ""}
                    </p>
                    {notice.appeal ? (
                      <div className="mt-2 rounded border border-[var(--accent)]/30 px-3 py-2 text-xs">
                        <div className="flex items-baseline gap-2">
                          <span className="font-semibold text-[var(--text)]">Your appeal</span>
                          <span className="ml-auto font-semibold uppercase tracking-wide text-[var(--muted)]">{notice.appeal.status}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap break-words text-[var(--muted)]">{notice.appeal.reason}</p>
                        {notice.appeal.decisionNote && <p className="mt-1 text-[var(--text)]">Moderator: {notice.appeal.decisionNote}</p>}
                      </div>
                    ) : notice.canAppeal ? (
                      <div className="mt-2 flex justify-end">
                        <button onClick={() => askAppeal(notice)} className="text-xs px-2 py-1 rounded bg-[var(--accent)] text-[var(--bg)] font-semibold hover:opacity-90 transition-opacity">
                          Appeal
                        </button>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-[var(--muted)]">The 14-day appeal window has closed.</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {dialog && (
        <div onClick={(e) => e.stopPropagation()}>
          <PromptDialog key={dialog.title} {...dialog} onCancel={() => setDialog(null)} />
        </div>
      )}
    </div>
  );
}
