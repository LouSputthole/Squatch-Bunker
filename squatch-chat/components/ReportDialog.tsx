"use client";

import PromptDialog from "@/components/PromptDialog";
import { toast, toastResponseError } from "@/lib/toast";

interface ReportDialogProps {
  targetUserId: string;
  /** Shown in the title, e.g. the reported user's display name. */
  targetName?: string;
  /** Set when reporting a specific message. */
  messageId?: string;
  onClose: () => void;
}

/** Reason prompt that files a report with the instance operator (POST /api/reports). */
export default function ReportDialog({ targetUserId, targetName, messageId, onClose }: ReportDialogProps) {
  async function submit(reason: string) {
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId, reason: reason.trim(), ...(messageId ? { messageId } : {}) }),
      });
      if (!res.ok) {
        await toastResponseError(res, "Couldn't send the report");
        return;
      }
      toast("Report sent. Thanks for letting us know.", "success");
      onClose();
    } catch {
      toast("Couldn't send the report", "error");
    }
  }

  return (
    <PromptDialog
      title={messageId ? "Report message" : `Report ${targetName ?? "user"}`}
      message={
        messageId
          ? `Tell the server operator what's wrong with this message${targetName ? ` from ${targetName}` : ""}.`
          : "Tell the server operator what's going on. Reports are private."
      }
      mode="textarea"
      label="Reason"
      placeholder="Describe the problem (at least 10 characters)"
      minLength={10}
      maxLength={1000}
      confirmLabel="Send report"
      destructive
      onConfirm={submit}
      onCancel={onClose}
    />
  );
}
