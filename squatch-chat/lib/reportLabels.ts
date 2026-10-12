/**
 * Ranger Desk vocabulary shared by server and client code. Kept free of
 * database imports so client components can use it.
 */
export const REPORT_ACTIONS = ["none", "message_deleted", "warned", "kicked", "banned"] as const;
export type ReportAction = (typeof REPORT_ACTIONS)[number];

export const REPORT_ACTION_LABELS: Record<ReportAction, string> = {
  none: "No action",
  message_deleted: "Message removed",
  warned: "Warning issued",
  kicked: "Removed from the camp",
  banned: "Banned",
};

/** What a notice says to the member it concerns. */
export const REPORT_ACTION_NOTICES: Record<Exclude<ReportAction, "none">, string> = {
  message_deleted: "A moderator removed one of your messages.",
  warned: "A moderator issued you a warning.",
  kicked: "You were removed from the camp.",
  banned: "You were banned from the camp.",
};
