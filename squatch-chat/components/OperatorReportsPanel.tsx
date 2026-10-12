"use client";

import { useState } from "react";
import PromptDialog, { type PromptDialogRequest } from "@/components/PromptDialog";
import type { OperatorMessageReportView, OperatorReportView } from "@/lib/reports";
import { toast, toastResponseError } from "@/lib/toast";

interface OperatorReportsPanelProps {
  unscoped: OperatorReportView[];
  escalated: OperatorReportView[];
  /** Every message report from the last 30 days, whatever its camp decided (Terms section 8). */
  recentMessages?: OperatorMessageReportView[];
}

function formatUtc(iso: string) {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Instance-operator desk on /admin: reports no community desk can see,
 * reports a desk escalated, and a read-only view of every message report
 * from the last 30 days. Closing one goes through /api/admin/reports/:id.
 */
export default function OperatorReportsPanel({ unscoped, escalated, recentMessages = [] }: OperatorReportsPanelProps) {
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<PromptDialogRequest | null>(null);

  async function close(report: OperatorReportView, status: "resolved" | "dismissed", action: "none" | "message_deleted", note: string) {
    setPending((prev) => new Set(prev).add(report.id));
    try {
      const res = await fetch(`/api/admin/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(status === "resolved" ? { action } : {}), note: note || null }),
      });
      if (!res.ok && res.status !== 409) {
        await toastResponseError(res, "Couldn't close the report");
        return false;
      }
      setHandled((prev) => new Set(prev).add(report.id));
      toast(status === "resolved" ? "Report resolved" : "Report dismissed", "success");
      return true;
    } catch {
      toast("Couldn't close the report", "error");
      return false;
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(report.id);
        return next;
      });
    }
  }

  function askClose(report: OperatorReportView, status: "resolved" | "dismissed", action: "none" | "message_deleted") {
    const what = status === "dismissed"
      ? "Dismiss this report"
      : action === "message_deleted" ? "Remove the message and resolve" : "Resolve without action";
    setDialog({
      title: what,
      message: "An optional note goes into the case history and the member's notice.",
      mode: "textarea",
      label: "Note",
      placeholder: "Optional",
      allowEmpty: true,
      maxLength: 1000,
      confirmLabel: status === "dismissed" ? "Dismiss" : "Resolve",
      destructive: action === "message_deleted",
      onConfirm: async (note) => {
        if (await close(report, status, action, note.trim())) setDialog(null);
      },
    });
  }

  function renderList(reports: OperatorReportView[], empty: string, escalatedList: boolean) {
    const visible = reports.filter((report) => !handled.has(report.id));
    if (visible.length === 0) return <p className="text-sm text-[var(--muted)]">{empty}</p>;
    return (
      <ul className="divide-y divide-[var(--accent-2)]/20">
        {visible.map((report) => {
          const busy = pending.has(report.id);
          return (
            <li key={report.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-baseline gap-2 text-xs">
                <strong>{report.reporter.username}</strong>
                <span className="text-[var(--muted)]">reported</span>
                <strong className="text-[var(--danger)]">{report.targetUser.username}</strong>
                {report.serverName && <span className="text-[var(--muted)]">in {report.serverName}</span>}
                {report.messageDeleted && <span className="text-[var(--muted)]">(message deleted)</span>}
                <span className="ml-auto text-[var(--muted)]">{formatUtc(report.createdAt)}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words">{report.reason}</p>
              {report.evidence && (
                <blockquote className="mt-1.5 border-l-2 border-[var(--accent-2)] pl-3 text-xs text-[var(--muted)]">
                  {report.evidence.channelName && <span className="block mb-0.5">#{report.evidence.channelName}</span>}
                  <span className="text-[var(--text)] break-words">{report.evidence.snippet || "(no text)"}</span>
                </blockquote>
              )}
              {escalatedList && report.escalation && (
                <p className="mt-1.5 text-xs text-[var(--accent)]">
                  Escalated {formatUtc(report.escalation.at)}
                  {report.escalation.note ? ` — ${report.escalation.note}` : ""}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-[10px] text-[var(--muted)]">id {report.id}</span>
                <button
                  disabled={busy}
                  onClick={() => askClose(report, "dismissed", "none")}
                  className="ml-auto text-xs px-2 py-1 rounded bg-[var(--panel-2)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--accent-2)]/40 transition-colors disabled:opacity-50"
                >
                  Dismiss
                </button>
                {report.evidence && !report.messageDeleted && (
                  <button
                    disabled={busy}
                    onClick={() => askClose(report, "resolved", "message_deleted")}
                    className="text-xs px-2 py-1 rounded bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 border border-[var(--danger)]/30 transition-colors disabled:opacity-50"
                  >
                    Remove message
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => askClose(report, "resolved", "none")}
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

  return (
    <>
      <section className="mt-8 bg-[var(--panel)] rounded-lg p-4">
        <h3 className="text-sm font-semibold text-[var(--muted)] mb-1 uppercase tracking-wide">
          Escalated by a camp&apos;s rangers
        </h3>
        <p className="text-xs text-[var(--muted)] mb-3">
          A moderator asked the operator to take over. The camp&apos;s desk can still close these itself.
        </p>
        {renderList(escalated, "Nothing escalated.", true)}
      </section>

      <section className="mt-8 bg-[var(--panel)] rounded-lg p-4">
        <h3 className="text-sm font-semibold text-[var(--muted)] mb-1 uppercase tracking-wide">
          Reports without a community
        </h3>
        <p className="text-xs text-[var(--muted)] mb-3">
          Reports with no community context (filed before Ranger Desk, or whose camp was deleted). Everything else is
          handled by each camp&apos;s moderators in the Moderation Panel.
        </p>
        {renderList(unscoped, "Nothing waiting.", false)}
      </section>

      {/* Message reports camp moderators handle, kept visible here for illegal content. */}
      <section className="mt-8 bg-[var(--panel)] rounded-lg p-4">
        <h3 className="text-sm font-semibold text-[var(--muted)] mb-1 uppercase tracking-wide">
          Message reports in camps (last 30 days)
        </h3>
        <p className="text-xs text-[var(--muted)] mb-3">
          Every report on a message, whatever the camp&apos;s rangers decided, with the message as it was when
          reported. Check these for anything illegal or involving a child&apos;s safety.
        </p>
        {recentMessages.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">None in the last 30 days.</p>
        ) : (
          <ul className="divide-y divide-[var(--accent-2)]/20">
            {recentMessages.map((report) => (
              <li key={report.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <strong>{report.reporter.username}</strong>
                  <span className="text-[var(--muted)]">reported</span>
                  <strong className="text-[var(--danger)]">{report.targetUser.username}</strong>
                  <span className="text-[var(--muted)]">
                    in {report.message.serverName ?? "a deleted camp"}
                    {report.message.channelName ? ` #${report.message.channelName}` : ""}
                  </span>
                  <span className={report.status === "open" || report.status === "escalated" ? "text-[var(--danger)]" : "text-[var(--muted)]"}>
                    {report.status}
                  </span>
                  {report.message.deleted && <span className="text-[var(--muted)]">(message deleted)</span>}
                  <span className="ml-auto text-[var(--muted)]">{formatUtc(report.createdAt)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words">{report.reason}</p>
                <blockquote className="mt-1.5 border-l-2 border-[var(--accent-2)] pl-3 text-xs text-[var(--muted)]">
                  <span className="text-[var(--text)] break-words">{report.message.snippet || "(no text)"}</span>
                </blockquote>
                <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                  id {report.id} · message {report.message.id}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {dialog && <PromptDialog key={dialog.title} {...dialog} onCancel={() => setDialog(null)} />}
    </>
  );
}
