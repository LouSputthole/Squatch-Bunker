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

/**
 * Reason prompt that files a report (POST /api/reports). A message report
 * goes to that camp's moderators (lib/reports.ts), who see the reporter's
 * username, and is listed on /admin for 30 days; a user report goes to
 * whoever runs this Campfire server (/admin) only. The
 * Terms (section 8) and Privacy Policy (section 5) say the same; keep in sync.
 */
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
          ? `Tell this camp's moderators what's wrong with this message${targetName ? ` from ${targetName}` : ""}. They will see the message, your reason, and your username, and so can the people who run this Campfire server.`
          : "Tell the people who run this Campfire server what's going on. They will see your username; the person you report won't be told who reported them."
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
