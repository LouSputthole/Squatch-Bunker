"use client";

import { useCallback, useEffect, useId, useState, type Dispatch, type SetStateAction } from "react";
import PromptDialog, { type PromptDialogRequest } from "@/components/PromptDialog";
import { useEscape } from "@/hooks/useEscape";
import { REPORT_ACTIONS, REPORT_ACTION_LABELS, type ReportAction } from "@/lib/reportLabels";
import { getSocket } from "@/lib/socket";
import { toast, toastResponseError } from "@/lib/toast";

interface UserRef {
  id: string;
  username: string;
}

export interface ServerReport {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  reporter: UserRef;
  target: UserRef;
  assignee: UserRef | null;
  assignedAt: string | null;
  message: {
    id: string;
    channelId: string | null;
    channelName: string | null;
    content: string;
    snippet: string;
    attachmentName: string | null;
    createdAt: string | null;
    deleted: boolean;
  } | null;
  escalation: { at: string; by: UserRef | null; note: string | null } | null;
  resolution: { action: string | null; note: string | null; at: string; by: UserRef | null } | null;
  appeal: {
    id: string;
    status: string;
    reason: string;
    createdAt: string;
    decisionNote: string | null;
    decidedAt: string | null;
  } | null;
  needsAttention: boolean;
}

interface ReportEvent {
  id: string;
  type: string;
  detail: string | null;
  createdAt: string;
  actor: UserRef | null;
}

interface ReportsPanelProps {
  serverId: string;
  currentUserId: string;
  /** Hidden panels stay mounted so the parent can show the open count as a badge. */
  visible: boolean;
  /** Attention count, or null when the viewer can't review reports here (a state setter). */
  onOpenCountChange?: Dispatch<SetStateAction<number | null>>;
  onJumpToMessage?: (channelId: string, messageId: string) => void;
}

type Filter = "attention" | "mine" | "recent";

const EVENT_LABELS: Record<string, string> = {
  filed: "Filed",
  assigned: "Assigned",
  unassigned: "Unassigned",
  escalated: "Escalated to the operator",
  resolved: "Resolved",
  dismissed: "Dismissed",
  appeal_filed: "Appeal filed",
  appeal_accepted: "Appeal accepted",
  appeal_rejected: "Appeal rejected",
};

const STATUS_STYLES: Record<string, string> = {
  open: "bg-[var(--accent)]/15 text-[var(--accent)]",
  escalated: "bg-[var(--danger)]/15 text-[var(--danger)]",
  resolved: "bg-[var(--panel-2)] text-[var(--muted)]",
  dismissed: "bg-[var(--panel-2)] text-[var(--muted)]",
};

const LONG_EVIDENCE = 320;

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Tell the open ChatPanel (same tab) and everyone else that the desk removed messages. */
function relayDeletedMessages(channelId: string, messageIds: string[]) {
  if (messageIds.length === 0) return;
  getSocket().emit("messages:purge", { channelId, messageIds });
  window.dispatchEvent(new CustomEvent("campfire:messages-deleted", { detail: { channelId, messageIds } }));
}

const buttonBase = "text-xs px-2 py-1 rounded border transition-colors disabled:opacity-50";
const quietButton = `${buttonBase} bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)] border-[var(--accent-2)]/40`;
const dangerButton = `${buttonBase} bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 border-[var(--danger)]/30`;
const primaryButton = "text-xs px-2 py-1 rounded bg-[var(--accent)] text-[var(--bg)] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50";

/** Resolve dialog: pick what was done about the member, with an optional note. */
function ResolveDialog({
  report,
  onConfirm,
  onCancel,
}: {
  report: ServerReport;
  onConfirm: (action: ReportAction, note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [action, setAction] = useState<ReportAction>(report.message && !report.message.deleted ? "message_deleted" : "none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const noteId = useId();
  useEscape(() => {
    if (!busy) onCancel();
  });
  const needsNote = action === "warned" && note.trim().length === 0;
  const actions = REPORT_ACTIONS.filter((a) => a !== "message_deleted" || (report.message && !report.message.deleted));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onClick={busy ? undefined : onCancel} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-[var(--accent-2)]/30 bg-[var(--panel)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-sm font-semibold text-[var(--text)]">Resolve report on {report.target.username}</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          The action is carried out now and recorded in the case. Anything but &quot;No action&quot; sends the member a notice they can appeal.
        </p>
        <fieldset className="mt-3 space-y-1.5">
          <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Action</legend>
          {actions.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm text-[var(--text)]">
              <input type="radio" name="report-action" value={value} checked={action === value} onChange={() => setAction(value)} disabled={busy} />
              {REPORT_ACTION_LABELS[value]}
            </label>
          ))}
        </fieldset>
        <label htmlFor={noteId} className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
          Note {action === "warned" ? "(the member reads this)" : "(optional)"}
        </label>
        <textarea
          id={noteId}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={1000}
          rows={3}
          disabled={busy}
          className="mt-1 w-full rounded-lg border border-[var(--accent-2)]/40 bg-[var(--panel-2)] px-3 py-2 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
          placeholder={action === "warned" ? "What they need to change" : "For the case history and the member's notice"}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onCancel} className={quietButton}>Cancel</button>
          <button
            type="button"
            disabled={busy || needsNote}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(action, note.trim());
              } finally {
                setBusy(false);
              }
            }}
            className={action === "kicked" || action === "banned" || action === "message_deleted" ? dangerButton : primaryButton}
          >
            {REPORT_ACTION_LABELS[action]}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Ranger Desk: the moderation case queue for one camp. */
export default function ReportsPanel({ serverId, currentUserId, visible, onOpenCountChange, onJumpToMessage }: ReportsPanelProps) {
  const [reports, setReports] = useState<ServerReport[]>([]);
  const [reviewers, setReviewers] = useState<UserRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<Filter>("attention");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<PromptDialogRequest | null>(null);
  const [resolving, setResolving] = useState<ServerReport | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set());
  const [histories, setHistories] = useState<Map<string, ReportEvent[] | "loading">>(new Map());

  const fetchReports = useCallback((includeRecent: boolean) => {
    setLoading(true);
    setLoadError(false);
    fetch(`/api/servers/${serverId}/reports${includeRecent ? "?include=recent" : ""}`)
      .then(async (res) => {
        if (res.status === 403) {
          setReports([]);
          onOpenCountChange?.(null);
          return;
        }
        if (!res.ok) throw new Error(`reports ${res.status}`);
        const data = await res.json();
        setReports(data.reports || []);
        setReviewers(data.reviewers || []);
        onOpenCountChange?.(data.openCount ?? 0);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, [serverId, onOpenCountChange]);

  useEffect(() => {
    const timer = setTimeout(() => fetchReports(filter === "recent"), 0);
    return () => clearTimeout(timer);
  }, [fetchReports, filter]);

  const refresh = useCallback(() => fetchReports(filter === "recent"), [fetchReports, filter]);

  function markPending(id: string, on: boolean) {
    setPending((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** PATCH the case; toasts the server's error. Returns the JSON body or null. */
  async function patchReport(report: ServerReport, body: unknown, fallback: string, path = ""): Promise<Record<string, unknown> | null> {
    markPending(report.id, true);
    try {
      const res = await fetch(`/api/servers/${serverId}/reports/${report.id}${path}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        // 409 = another ranger got there first; the refresh shows the new state.
        if (res.status === 409) {
          toast("Another ranger already handled this", "info");
          refresh();
          return null;
        }
        await toastResponseError(res, fallback);
        return null;
      }
      return (await res.json()) as Record<string, unknown>;
    } catch {
      toast(fallback, "error");
      return null;
    } finally {
      markPending(report.id, false);
    }
  }

  async function assign(report: ServerReport, assigneeId: string | null) {
    const result = await patchReport(report, { assigneeId }, "Couldn't update the assignment");
    if (!result) return;
    const assignee = (result.report as { assignee: UserRef | null } | undefined)?.assignee ?? null;
    setReports((prev) => prev.map((r) => (r.id === report.id ? { ...r, assignee, assignedAt: assignee ? new Date().toISOString() : null } : r)));
    toast(assignee ? `Assigned to ${assignee.username}` : "Unassigned", "success");
  }

  function askEscalate(report: ServerReport) {
    setDialog({
      title: "Escalate to the instance operator",
      message: "The operator sees the case with your note. Your desk can still close it in the meantime.",
      mode: "textarea",
      label: "Why this needs the operator",
      placeholder: "Optional",
      allowEmpty: true,
      maxLength: 1000,
      confirmLabel: "Escalate",
      onConfirm: async (note) => {
        const result = await patchReport(report, { status: "escalated", note: note.trim() || null }, "Couldn't escalate the report");
        if (!result) return;
        setDialog(null);
        toast("Escalated to the operator", "success");
        refresh();
      },
    });
  }

  function askDismiss(report: ServerReport) {
    setDialog({
      title: "Dismiss this report?",
      message: "No action is taken. The reporter is told it was reviewed; the reported member isn't told anything.",
      mode: "textarea",
      label: "Note for the case history",
      placeholder: "Optional",
      allowEmpty: true,
      maxLength: 1000,
      confirmLabel: "Dismiss",
      onConfirm: async (note) => {
        const result = await patchReport(report, { status: "dismissed", note: note.trim() || null }, "Couldn't dismiss the report");
        if (!result) return;
        setDialog(null);
        toast("Report dismissed", "success");
        refresh();
      },
    });
  }

  async function resolve(report: ServerReport, action: ReportAction, note: string) {
    const result = await patchReport(report, { status: "resolved", action, note: note || null }, "Couldn't resolve the report");
    if (!result) return;
    setResolving(null);
    const deleted = Array.isArray(result.deletedMessageIds) ? (result.deletedMessageIds as string[]) : [];
    if (typeof result.channelId === "string") relayDeletedMessages(result.channelId, deleted);
    toast(`Resolved — ${REPORT_ACTION_LABELS[action].toLowerCase()}`, "success");
    refresh();
  }

  function askDecideAppeal(report: ServerReport, decision: "accepted" | "rejected") {
    const lifts = decision === "accepted" && report.resolution?.action === "banned";
    setDialog({
      title: decision === "accepted" ? "Accept the appeal?" : "Reject the appeal?",
      message: decision === "accepted"
        ? `${lifts ? "Their ban is lifted. " : ""}Your note goes to the member.`
        : "The decision stands. Your note goes to the member.",
      mode: "textarea",
      label: "Note to the member",
      placeholder: "Optional",
      allowEmpty: true,
      maxLength: 1000,
      confirmLabel: decision === "accepted" ? "Accept" : "Reject",
      destructive: decision === "rejected",
      onConfirm: async (note) => {
        const result = await patchReport(report, { decision, note: note.trim() || null }, "Couldn't decide the appeal", "/appeal");
        if (!result) return;
        setDialog(null);
        toast(`Appeal ${decision}`, "success");
        refresh();
      },
    });
  }

  async function toggleHistory(report: ServerReport) {
    if (histories.has(report.id)) {
      setHistories((prev) => {
        const next = new Map(prev);
        next.delete(report.id);
        return next;
      });
      return;
    }
    setHistories((prev) => new Map(prev).set(report.id, "loading"));
    try {
      const res = await fetch(`/api/servers/${serverId}/reports/${report.id}`);
      if (!res.ok) throw new Error(`case ${res.status}`);
      const data = await res.json();
      setHistories((prev) => new Map(prev).set(report.id, data.events || []));
    } catch {
      setHistories((prev) => {
        const next = new Map(prev);
        next.delete(report.id);
        return next;
      });
      toast("Couldn't load the case history", "error");
    }
  }

  if (!visible) return null;

  const shown = filter === "mine" ? reports.filter((r) => r.assignee?.id === currentUserId) : reports;

  const filterTabs = (
    <div role="tablist" aria-label="Report filters" className="mb-3 flex gap-1">
      {([["attention", "Needs attention"], ["mine", "Mine"], ["recent", "Last 30 days"]] as const).map(([value, label]) => (
        <button
          key={value}
          role="tab"
          aria-selected={filter === value}
          onClick={() => setFilter(value)}
          className={`text-xs px-2 py-1 rounded transition-colors ${filter === value ? "bg-[var(--panel-2)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (loading) {
    return (
      <>
        {filterTabs}
        <div className="flex justify-center py-12 text-sm text-[var(--muted)]">Loading reports...</div>
      </>
    );
  }
  if (loadError) {
    return (
      <>
        {filterTabs}
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-[var(--muted)]" role="alert">
          Couldn&apos;t load reports.
          <button onClick={refresh} className="text-xs px-3 py-1 rounded bg-[var(--panel-2)] text-[var(--text)] hover:bg-[var(--accent-2)] transition-colors">
            Retry
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      {filterTabs}
      {shown.length === 0 ? (
        <div className="flex flex-col items-center gap-1 py-12 text-sm text-[var(--muted)]">
          <span aria-hidden="true" className="text-2xl">🏕️</span>
          {filter === "mine" ? "Nothing assigned to you" : filter === "recent" ? "No reports in the last 30 days" : "No open reports — the camp is calm"}
        </div>
      ) : (
        <ul className="space-y-2" aria-label="Reports">
          {shown.map((report) => {
            const busy = pending.has(report.id);
            const actionable = report.status === "open" || report.status === "escalated";
            const evidence = report.message;
            const evidenceLong = !!evidence && evidence.content.length > LONG_EVIDENCE;
            const evidenceExpanded = expandedEvidence.has(report.id);
            const history = histories.get(report.id);
            const mine = report.assignee?.id === currentUserId;
            return (
              <li key={report.id} className="rounded-lg border border-[var(--accent-2)]/30 bg-[var(--panel-2)]/40 px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wide ${STATUS_STYLES[report.status] ?? STATUS_STYLES.open}`}>
                    {report.status}
                  </span>
                  {report.appeal?.status === "open" && (
                    <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-[var(--accent)]">Appeal pending</span>
                  )}
                  {report.assignee ? (
                    <span className="text-[var(--muted)]">{mine ? "Yours" : `Assigned to ${report.assignee.username}`}</span>
                  ) : actionable ? (
                    <span className="text-[var(--muted)]">Unassigned</span>
                  ) : null}
                  <span className="ml-auto text-[var(--muted)]">{formatWhen(report.createdAt)}</span>
                </div>

                <div className="mt-1.5 flex items-baseline gap-2 flex-wrap text-xs">
                  <span className="font-semibold text-[var(--text)]">{report.reporter.username}</span>
                  <span className="text-[var(--muted)]">reported</span>
                  <span className="font-semibold text-[var(--danger)]">{report.target.username}</span>
                  {!evidence && <span className="text-[var(--muted)]">· about the member, no message attached</span>}
                </div>
                <p className="mt-1.5 text-sm text-[var(--text)] whitespace-pre-wrap break-words">{report.reason}</p>

                {evidence && (
                  <blockquote className="mt-2 border-l-2 border-[var(--accent-2)] pl-3 text-xs text-[var(--muted)]">
                    <span className="block mb-0.5">
                      {evidence.channelName ? `#${evidence.channelName}` : "a channel"}
                      {evidence.createdAt ? ` · ${formatWhen(evidence.createdAt)}` : ""}
                      {evidence.deleted && <span className="ml-2 rounded bg-[var(--panel-2)] px-1 py-px text-[10px] uppercase">message deleted · snapshot</span>}
                    </span>
                    <span className="text-[var(--text)] whitespace-pre-wrap break-words">
                      {evidenceLong && !evidenceExpanded ? `${evidence.content.slice(0, LONG_EVIDENCE)}…` : evidence.content || "(no text)"}
                    </span>
                    {evidenceLong && (
                      <button
                        onClick={() => setExpandedEvidence((prev) => {
                          const next = new Set(prev);
                          if (next.has(report.id)) next.delete(report.id);
                          else next.add(report.id);
                          return next;
                        })}
                        className="ml-1 text-[var(--accent)] hover:underline"
                      >
                        {evidenceExpanded ? "Show less" : "Show all"}
                      </button>
                    )}
                    {evidence.attachmentName && (
                      <span className="block mt-0.5">📎 {evidence.attachmentName}{evidence.deleted ? " (removed with the message)" : ""}</span>
                    )}
                  </blockquote>
                )}

                {report.escalation && (
                  <p className="mt-2 text-xs text-[var(--danger)]">
                    Escalated{report.escalation.by ? ` by ${report.escalation.by.username}` : ""} · {formatWhen(report.escalation.at)}
                    {report.escalation.note ? ` — ${report.escalation.note}` : ""}
                  </p>
                )}
                {report.resolution && (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {report.status === "resolved" ? "Resolved" : "Dismissed"}
                    {report.resolution.by ? ` by ${report.resolution.by.username}` : ""} · {formatWhen(report.resolution.at)}
                    {report.resolution.action ? ` — ${REPORT_ACTION_LABELS[report.resolution.action as ReportAction] ?? report.resolution.action}` : ""}
                    {report.resolution.note ? ` — ${report.resolution.note}` : ""}
                  </p>
                )}

                {report.appeal && (
                  <div className="mt-2 rounded border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-2 text-xs">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-semibold text-[var(--text)]">Appeal from {report.target.username}</span>
                      <span className="text-[var(--muted)]">{formatWhen(report.appeal.createdAt)}</span>
                      {report.appeal.status !== "open" && (
                        <span className="ml-auto font-semibold uppercase tracking-wide text-[var(--muted)]">{report.appeal.status}</span>
                      )}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-[var(--text)]">{report.appeal.reason}</p>
                    {report.appeal.decisionNote && <p className="mt-1 text-[var(--muted)]">Decision: {report.appeal.decisionNote}</p>}
                    {report.appeal.status === "open" && (
                      <div className="mt-2 flex justify-end gap-1.5">
                        <button disabled={busy} onClick={() => askDecideAppeal(report, "rejected")} className={quietButton}>Reject</button>
                        <button disabled={busy} onClick={() => askDecideAppeal(report, "accepted")} className={primaryButton}>Accept</button>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  {actionable && (
                    <>
                      <label className="sr-only" htmlFor={`assignee-${report.id}`}>Assignee</label>
                      <select
                        id={`assignee-${report.id}`}
                        disabled={busy}
                        value={report.assignee?.id ?? ""}
                        onChange={(e) => void assign(report, e.target.value || null)}
                        className="text-xs px-1.5 py-1 rounded bg-[var(--panel-2)] text-[var(--text)] border border-[var(--accent-2)]/40 focus:outline-none disabled:opacity-50 cursor-pointer max-w-[12rem]"
                      >
                        <option value="">Unassigned</option>
                        {reviewers.filter((r) => r.id !== report.target.id).map((r) => (
                          <option key={r.id} value={r.id}>{r.username}{r.id === currentUserId ? " (you)" : ""}</option>
                        ))}
                      </select>
                      {!report.assignee && (
                        <button disabled={busy} onClick={() => void assign(report, currentUserId)} className={quietButton}>Take</button>
                      )}
                    </>
                  )}
                  {onJumpToMessage && evidence && !evidence.deleted && evidence.channelId && (
                    <button onClick={() => onJumpToMessage(evidence.channelId!, evidence.id)} className="text-xs px-2 py-1 rounded text-[var(--accent)] hover:underline">
                      Jump to message
                    </button>
                  )}
                  <button onClick={() => void toggleHistory(report)} className="text-xs px-2 py-1 rounded text-[var(--muted)] hover:text-[var(--text)]">
                    {history ? "Hide history" : "History"}
                  </button>
                  {actionable && (
                    <>
                      <span className="flex-1" />
                      {report.status === "open" && (
                        <button disabled={busy} onClick={() => askEscalate(report)} className={quietButton}>Escalate</button>
                      )}
                      <button disabled={busy} onClick={() => askDismiss(report)} className={quietButton}>Dismiss</button>
                      <button disabled={busy} onClick={() => setResolving(report)} className={primaryButton}>Resolve…</button>
                    </>
                  )}
                </div>

                {history && (
                  <ol className="mt-2 space-y-0.5 border-t border-[var(--accent-2)]/20 pt-2 text-xs text-[var(--muted)]" aria-label="Case history">
                    {history === "loading" ? (
                      <li>Loading…</li>
                    ) : history.length === 0 ? (
                      <li>No events yet.</li>
                    ) : history.map((event) => (
                      <li key={event.id}>
                        <span className="text-[var(--text)]">{EVENT_LABELS[event.type] ?? event.type}</span>
                        {event.actor ? ` by ${event.actor.username}` : ""} · {formatWhen(event.createdAt)}
                        {event.detail ? ` — ${event.detail}` : ""}
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialog && (
        <div onClick={(e) => e.stopPropagation()}>
          <PromptDialog key={dialog.title} {...dialog} onCancel={() => setDialog(null)} />
        </div>
      )}
      {resolving && (
        <div onClick={(e) => e.stopPropagation()}>
          <ResolveDialog report={resolving} onConfirm={(action, note) => resolve(resolving, action, note)} onCancel={() => setResolving(null)} />
        </div>
      )}
    </>
  );
}
