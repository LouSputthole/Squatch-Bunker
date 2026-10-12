import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { actorOutranksTarget, getMemberHierarchyIdentity } from "@/lib/memberHierarchy";
import { requireMembership } from "@/lib/membership";
import {
  cleanupDeletedMessageUploads,
  collectThreadReplies,
  type DeletableMessage,
} from "@/lib/messageRetention";
import {
  createSimpleNotification,
  emitNotification,
  type NotificationRecord,
} from "@/lib/notifications";
import { hasPermission, type PermKey } from "@/lib/permissions";
import { prismaErrorCode } from "@/lib/prismaErrors";
import { notifyRealtimeAuthorizationChange } from "@/lib/realtimeControl";
import { getPermContext } from "@/lib/serverRoles";
import { REPORT_ACTIONS, REPORT_ACTION_LABELS, type ReportAction } from "@/lib/reportLabels";

/**
 * Ranger Desk — the per-server moderation case desk.
 *
 * A report belongs to the community it was filed in (`Report.serverId`, fixed
 * at filing). Message reports also carry an evidence snapshot of the message
 * taken at filing time, so a case survives the message or its channel being
 * deleted. Rules every reviewer path applies:
 *
 * - a reviewer holds MANAGE_MESSAGES, KICK_MEMBERS, or BAN_MEMBERS in the server;
 * - a reviewer never sees or acts on a report that targets themselves;
 * - a message report stays hidden from reviewers who cannot view its channel
 *   (while the channel exists), so channel privacy carries into the desk;
 * - reports with no community (legacy rows, deleted server) and escalated
 *   reports go to the instance operator (app/admin).
 */

export const REPORT_STATUSES = ["open", "escalated", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
/** Statuses a report can be closed with. */
export const REPORT_RESOLUTIONS = ["resolved", "dismissed"] as const;
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];
/** What a "resolved" report did about the member (vocabulary in lib/reportLabels). */
export { REPORT_ACTIONS, REPORT_ACTION_LABELS, type ReportAction } from "@/lib/reportLabels";
/** Actions the instance operator can take without server permissions. */
export const OPERATOR_ACTIONS: ReportAction[] = ["none", "message_deleted"];
export const APPEAL_DECISIONS = ["accepted", "rejected"] as const;
export type AppealDecision = (typeof APPEAL_DECISIONS)[number];

/** Any of these lets a member review reports (mods hold the first two by default). */
export const REPORT_REVIEW_PERMISSIONS: PermKey[] = ["MANAGE_MESSAGES", "KICK_MEMBERS", "BAN_MEMBERS"];

export const MAX_REPORT_NOTE_LENGTH = 1000;
export const MIN_APPEAL_REASON_LENGTH = 10;
export const APPEAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const SNIPPET_LENGTH = 200;
const MAX_LISTED = 200;
const MAX_REVIEWERS = 100;
const RECENT_HANDLED_MS = 30 * 24 * 60 * 60 * 1000;

/** Thrown by desk mutations; routes map it straight to a JSON error. */
export class ReportActionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ReportActionError";
  }
}

export function parseReportResolution(value: unknown): ReportResolution | null {
  return typeof value === "string" && (REPORT_RESOLUTIONS as readonly string[]).includes(value)
    ? (value as ReportResolution)
    : null;
}

export function parseReportAction(value: unknown): ReportAction | null {
  return typeof value === "string" && (REPORT_ACTIONS as readonly string[]).includes(value)
    ? (value as ReportAction)
    : null;
}

export function parseAppealDecision(value: unknown): AppealDecision | null {
  return typeof value === "string" && (APPEAL_DECISIONS as readonly string[]).includes(value)
    ? (value as AppealDecision)
    : null;
}

/** Trimmed optional note, or `undefined` when the value is not usable. */
export function parseNote(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const note = value.trim();
  if (note.length > MAX_REPORT_NOTE_LENGTH) return undefined;
  return note.length > 0 ? note : null;
}

export async function canReviewReports(serverId: string, userId: string): Promise<boolean> {
  const context = await getPermContext(serverId, userId);
  if (!context.isMember) return false;
  return REPORT_REVIEW_PERMISSIONS.some((perm) => hasPermission(perm, context));
}

// ───────────────────────────── evidence ─────────────────────────────

export interface EvidenceSourceMessage {
  content: string;
  attachmentName: string | null;
  attachmentUrl: string | null;
  channelId: string;
  createdAt: Date;
  channel: { name: string; serverId: string };
}

/** Columns a freshly filed message report stores from the message. */
export function evidenceFromMessage(message: EvidenceSourceMessage) {
  return {
    serverId: message.channel.serverId,
    evidenceContent: message.content,
    evidenceAttachmentName: message.attachmentName,
    evidenceAttachmentUrl: message.attachmentUrl,
    evidenceChannelId: message.channelId,
    evidenceChannelName: message.channel.name,
    evidenceMessageAt: message.createdAt,
  };
}

// ───────────────────────────── scoping ─────────────────────────────

interface ReviewableRow {
  targetUserId: string;
  serverId: string | null;
  evidenceChannelId: string | null;
}

/**
 * Keep the reports this viewer may review in this server: filed here, not
 * about the viewer, and (for message reports) in a channel the viewer can
 * still see. A deleted evidence channel no longer restricts anyone — the
 * snapshot is all that is left and the desk has to be able to close the case.
 */
async function filterReviewable<T extends ReviewableRow>(
  serverId: string,
  viewerId: string,
  reports: T[],
): Promise<T[]> {
  const candidates = reports.filter((r) => r.serverId === serverId && r.targetUserId !== viewerId);
  const channelIds = [...new Set(candidates.map((r) => r.evidenceChannelId).filter((id): id is string => !!id))];
  const existing = channelIds.length > 0
    ? new Set((await prisma.channel.findMany({ where: { id: { in: channelIds } }, select: { id: true } })).map((c) => c.id))
    : new Set<string>();

  const canViewChannel = new Map<string, boolean>();
  const scoped: T[] = [];
  for (const report of candidates) {
    const channelId = report.evidenceChannelId;
    if (!channelId || !existing.has(channelId)) {
      scoped.push(report);
      continue;
    }
    let canView = canViewChannel.get(channelId);
    if (canView === undefined) {
      const access = await resolveChannelAccess(channelId, viewerId);
      canView = access?.canView === true && access.serverId === serverId;
      canViewChannel.set(channelId, canView);
    }
    if (canView) scoped.push(report);
  }
  return scoped;
}

export async function viewerCanReviewReport(
  serverId: string,
  viewerId: string,
  report: ReviewableRow,
): Promise<boolean> {
  return (await filterReviewable(serverId, viewerId, [report])).length === 1;
}

// ───────────────────────────── reading ─────────────────────────────

const caseInclude = {
  reporter: { select: { id: true, username: true } },
  targetUser: { select: { id: true, username: true } },
  assignee: { select: { id: true, username: true } },
  appeal: true,
} satisfies Prisma.ReportInclude;

type CaseRow = Prisma.ReportGetPayload<{ include: typeof caseInclude }>;

interface UserRef {
  id: string;
  username: string;
}

export interface ServerReportView {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  reporter: UserRef;
  target: UserRef;
  assignee: UserRef | null;
  assignedAt: string | null;
  /** Message evidence (null for user-level reports). */
  message: {
    id: string;
    channelId: string | null;
    channelName: string | null;
    content: string;
    snippet: string;
    attachmentName: string | null;
    createdAt: string | null;
    /** The message no longer exists; the snapshot is all that is left. */
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
  /** Open, escalated, or carrying an undecided appeal. */
  needsAttention: boolean;
}

function snippetOf(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > SNIPPET_LENGTH ? `${collapsed.slice(0, SNIPPET_LENGTH - 1)}…` : collapsed;
}

function needsAttention(report: { status: string; appeal: { status: string } | null }): boolean {
  return report.status === "open" || report.status === "escalated" || report.appeal?.status === "open";
}

async function usersById(ids: Array<string | null | undefined>): Promise<Map<string, UserRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, username: true } });
  return new Map(users.map((user) => [user.id, user]));
}

async function toCaseViews(rows: CaseRow[]): Promise<ServerReportView[]> {
  const messageIds = rows.map((r) => r.messageId).filter((id): id is string => !!id);
  const [surviving, users] = await Promise.all([
    messageIds.length > 0
      ? prisma.message.findMany({ where: { id: { in: messageIds } }, select: { id: true } })
        .then((messages) => new Set(messages.map((m) => m.id)))
      : Promise.resolve(new Set<string>()),
    usersById(rows.flatMap((r) => [r.escalatedById, r.resolvedById])),
  ]);

  return rows.map((report) => ({
    id: report.id,
    status: report.status,
    reason: report.reason,
    createdAt: report.createdAt.toISOString(),
    reporter: report.reporter,
    target: report.targetUser,
    assignee: report.assignee,
    assignedAt: report.assignedAt?.toISOString() ?? null,
    message: report.messageId
      ? {
          id: report.messageId,
          channelId: report.evidenceChannelId,
          channelName: report.evidenceChannelName,
          content: report.evidenceContent ?? "",
          snippet: snippetOf(report.evidenceContent ?? ""),
          attachmentName: report.evidenceAttachmentName,
          createdAt: report.evidenceMessageAt?.toISOString() ?? null,
          deleted: !surviving.has(report.messageId),
        }
      : null,
    escalation: report.escalatedAt
      ? {
          at: report.escalatedAt.toISOString(),
          by: (report.escalatedById && users.get(report.escalatedById)) || null,
          note: report.escalationNote,
        }
      : null,
    resolution: report.resolvedAt
      ? {
          action: report.resolution,
          note: report.resolutionNote,
          at: report.resolvedAt.toISOString(),
          by: (report.resolvedById && users.get(report.resolvedById)) || null,
        }
      : null,
    appeal: report.appeal
      ? {
          id: report.appeal.id,
          status: report.appeal.status,
          reason: report.appeal.reason,
          createdAt: report.appeal.createdAt.toISOString(),
          decisionNote: report.appeal.decisionNote,
          decidedAt: report.appeal.decidedAt?.toISOString() ?? null,
        }
      : null,
    needsAttention: needsAttention(report),
  }));
}

/**
 * The desk queue: every report in this server that needs attention (open,
 * escalated, or with an undecided appeal) plus, with includeRecent, ones filed
 * in the last 30 days that were since handled. Scoped to what the viewer may
 * review.
 */
export async function listServerReports(
  serverId: string,
  viewerId: string,
  options: { includeRecent?: boolean; now?: Date } = {},
): Promise<{ reports: ServerReportView[]; openCount: number }> {
  const now = options.now ?? new Date();
  const rows = await prisma.report.findMany({
    where: {
      serverId,
      targetUserId: { not: viewerId },
      OR: [
        { status: { in: ["open", "escalated"] } },
        { appeal: { is: { status: "open" } } },
        ...(options.includeRecent
          ? [{ createdAt: { gte: new Date(now.getTime() - RECENT_HANDLED_MS) } }]
          : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_LISTED,
    include: caseInclude,
  });
  const reports = await toCaseViews(await filterReviewable(serverId, viewerId, rows));
  // Attention first, newest first within each group (sort is stable).
  reports.sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention));
  return { reports, openCount: reports.filter((r) => r.needsAttention).length };
}

export interface ReportEventView {
  id: string;
  type: string;
  detail: string | null;
  createdAt: string;
  actor: UserRef | null;
}

/** One case with its history, or null when this viewer can't review it here. */
export async function getServerReportCase(
  serverId: string,
  viewerId: string,
  reportId: string,
): Promise<{ report: ServerReportView; events: ReportEventView[] } | null> {
  const row = await prisma.report.findUnique({ where: { id: reportId }, include: caseInclude });
  if (!row || !(await viewerCanReviewReport(serverId, viewerId, row))) return null;
  const [[report], events] = await Promise.all([
    toCaseViews([row]),
    prisma.reportEvent.findMany({ where: { reportId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
  ]);
  const actors = await usersById(events.map((event) => event.actorId));
  return {
    report,
    events: events.map((event) => ({
      id: event.id,
      type: event.type,
      detail: event.detail,
      createdAt: event.createdAt.toISOString(),
      actor: (event.actorId && actors.get(event.actorId)) || null,
    })),
  };
}

/** Members who can review reports here — the assignment candidates. */
export async function listReportReviewers(serverId: string): Promise<UserRef[]> {
  const [server, members] = await Promise.all([
    prisma.server.findUnique({
      where: { id: serverId },
      select: {
        owner: { select: { id: true, username: true } },
        roles: { where: { isDefault: true }, select: { permissions: true } },
      },
    }),
    prisma.serverMember.findMany({
      where: { serverId, banned: false },
      select: {
        role: true,
        user: { select: { id: true, username: true } },
        memberRoles: { select: { role: { select: { permissions: true } } } },
      },
    }),
  ]);
  if (!server) return [];
  const defaultJsons = server.roles.map((role) => role.permissions);
  const reviewers = new Map<string, UserRef>([[server.owner.id, server.owner]]);
  for (const member of members) {
    const context = {
      tier: member.role,
      rolePermissionJsons: [...defaultJsons, ...member.memberRoles.map((mr) => mr.role.permissions)],
    };
    if (REPORT_REVIEW_PERMISSIONS.some((perm) => hasPermission(perm, context))) {
      reviewers.set(member.user.id, member.user);
    }
  }
  return [...reviewers.values()]
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, MAX_REVIEWERS);
}

// ───────────────────────────── desk mutations ─────────────────────────────

type Tx = Prisma.TransactionClient;

async function loadReviewableCase(serverId: string, viewerId: string, reportId: string) {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      reporter: { select: { id: true, username: true } },
      targetUser: { select: { id: true, username: true } },
      server: { select: { id: true, name: true } },
      appeal: true,
    },
  });
  if (!report || !(await viewerCanReviewReport(serverId, viewerId, report))) {
    throw new ReportActionError(404, "Report not found");
  }
  return report;
}

async function requireReviewer(serverId: string, userId: string) {
  const context = await getPermContext(serverId, userId);
  if (!context.isMember || !REPORT_REVIEW_PERMISSIONS.some((perm) => hasPermission(perm, context))) {
    throw new ReportActionError(403, "No permission");
  }
  return context;
}

/** Assign (or, with null, unassign) an open report to a reviewer of this server. */
export async function assignServerReport(input: {
  serverId: string;
  actorId: string;
  reportId: string;
  assigneeId: string | null;
}): Promise<{ assignee: UserRef | null }> {
  const { serverId, actorId, reportId, assigneeId } = input;
  await requireReviewer(serverId, actorId);
  const report = await loadReviewableCase(serverId, actorId, reportId);
  if (report.status !== "open" && report.status !== "escalated") {
    throw new ReportActionError(409, "Report was already handled");
  }

  let assignee: UserRef | null = null;
  if (assigneeId) {
    const eligible = await canReviewReports(serverId, assigneeId)
      && (await viewerCanReviewReport(serverId, assigneeId, report));
    if (!eligible) throw new ReportActionError(400, "That member can't review this report here");
    assignee = await prisma.user.findUnique({ where: { id: assigneeId }, select: { id: true, username: true } });
    if (!assignee) throw new ReportActionError(400, "That member can't review this report here");
  }

  const changed = await prisma.$transaction(async (tx) => {
    const updated = await tx.report.updateMany({
      where: { id: report.id, status: { in: ["open", "escalated"] } },
      data: { assigneeId: assignee?.id ?? null, assignedAt: assignee ? new Date() : null },
    });
    if (updated.count === 0) return false;
    await tx.reportEvent.create({
      data: {
        reportId: report.id,
        actorId,
        type: assignee ? "assigned" : "unassigned",
        detail: assignee ? `Assigned to ${assignee.username}` : null,
      },
    });
    await tx.auditLog.create({
      data: {
        serverId,
        actorId,
        targetId: null,
        action: assignee ? "report_assign" : "report_unassign",
        detail: assignee ? `Report ${report.id} assigned to ${assignee.username}` : `Report ${report.id} unassigned`,
      },
    });
    return true;
  });
  if (!changed) throw new ReportActionError(409, "Report was already handled");
  return { assignee };
}

/** Hand an open report to the instance operator. The desk can still close it. */
export async function escalateServerReport(input: {
  serverId: string;
  actorId: string;
  reportId: string;
  note: string | null;
}): Promise<void> {
  const { serverId, actorId, reportId, note } = input;
  await requireReviewer(serverId, actorId);
  const report = await loadReviewableCase(serverId, actorId, reportId);
  if (report.status === "escalated") throw new ReportActionError(409, "Report is already escalated");
  if (report.status !== "open") throw new ReportActionError(409, "Report was already handled");

  const changed = await prisma.$transaction(async (tx) => {
    const updated = await tx.report.updateMany({
      where: { id: report.id, status: "open" },
      data: { status: "escalated", escalatedById: actorId, escalatedAt: new Date(), escalationNote: note },
    });
    if (updated.count === 0) return false;
    await tx.reportEvent.create({
      data: { reportId: report.id, actorId, type: "escalated", detail: note },
    });
    await tx.auditLog.create({
      data: {
        serverId,
        actorId,
        targetId: null,
        action: "report_escalate",
        detail: `Report ${report.id} escalated to the instance operator`,
      },
    });
    return true;
  });
  if (!changed) throw new ReportActionError(409, "Report was already handled");
}

export interface CloseReportResult {
  report: { id: string; status: ReportResolution; action: ReportAction | null };
  /** Messages the resolution removed; the client relays these over the socket. */
  deletedMessageIds: string[];
  channelId: string | null;
}

interface ClosePlan {
  tx: Tx;
  report: {
    id: string;
    messageId: string | null;
    evidenceChannelId: string | null;
    evidenceChannelName: string | null;
    reporterId: string;
    targetUserId: string;
    serverId: string | null;
    server: { name: string } | null;
  };
  actorId: string;
  status: ReportResolution;
  action: ReportAction | null;
  note: string | null;
  /** Server name for notifications when the report has no server. */
  contextName: string;
}

/** The status/event/notification writes every close path shares. Returns false when the CAS lost. */
async function applyClose(plan: ClosePlan): Promise<{ notifications: NotificationRecord[] } | null> {
  const { tx, report, actorId, status, action, note } = plan;
  const updated = await tx.report.updateMany({
    where: { id: report.id, status: { in: ["open", "escalated"] } },
    data: {
      status,
      resolvedById: actorId,
      resolvedAt: new Date(),
      resolution: status === "resolved" ? action : null,
      resolutionNote: note,
    },
  });
  if (updated.count === 0) return null;

  const detail = status === "resolved"
    ? `${REPORT_ACTION_LABELS[action ?? "none"]}${note ? ` — ${note}` : ""}`
    : note;
  await tx.reportEvent.create({ data: { reportId: report.id, actorId, type: status, detail } });
  if (report.serverId) {
    await tx.auditLog.create({
      data: {
        serverId: report.serverId,
        actorId,
        // No reporter or target here: anyone with VIEW_AUDIT_LOG (incl. a reported
        // moderator) can read the log, and the desk hides reports about the viewer.
        targetId: null,
        action: status === "resolved" ? "report_resolve" : "report_dismiss",
        detail: `Report ${report.id} marked ${status}${status === "resolved" ? ` (${action ?? "none"})` : ""}`,
      },
    });
  }

  const where = report.server?.name ?? plan.contextName;
  const notifications: NotificationRecord[] = [];
  if (status === "resolved" && action && action !== "none") {
    const channel = report.evidenceChannelName ? `#${report.evidenceChannelName}` : "a channel";
    const phrase = {
      message_deleted: `A moderator removed your message in ${channel}.`,
      warned: "A moderator issued you a warning.",
      kicked: `You were removed from ${where}.`,
      banned: `You were banned from ${where}.`,
    }[action];
    notifications.push(await createSimpleNotification({
      userId: report.targetUserId,
      type: "moderation",
      title: `Moderation notice · ${where}`,
      body: `${phrase}${note ? ` Reason: ${note}` : ""} You can appeal from this notice.`,
      serverId: report.serverId,
    }, tx));
  }
  notifications.push(await createSimpleNotification({
    userId: report.reporterId,
    type: "report_update",
    title: "Your report was reviewed",
    body: status === "resolved"
      ? `A moderator of ${where} took action on your report. Thank you.`
      : `A moderator of ${where} reviewed your report and closed it without action.`,
    serverId: report.serverId,
  }, tx));
  return { notifications };
}

/** Delete the reported message (and its thread replies) if it still exists. */
async function deleteEvidenceMessage(tx: Tx, messageId: string | null): Promise<{ deleted: DeletableMessage[]; channelId: string | null }> {
  if (!messageId) return { deleted: [], channelId: null };
  const message = await tx.message.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, attachmentUrl: true, privateUploadId: true },
  });
  if (!message) return { deleted: [], channelId: null };
  const replies = await collectThreadReplies(tx, [message.id]);
  await tx.message.deleteMany({ where: { id: { in: [message.id, ...replies.map((reply) => reply.id)] } } });
  return { deleted: [message, ...replies], channelId: message.channelId };
}

/**
 * Close a report from the server desk. "resolved" records (and performs) an
 * action on the member; "dismissed" closes it without one. Member actions
 * reuse the member routes' permission and hierarchy rules.
 */
export async function closeServerReport(input: {
  serverId: string;
  actorId: string;
  reportId: string;
  status: ReportResolution;
  action: ReportAction | null;
  note: string | null;
}): Promise<CloseReportResult> {
  const { serverId, actorId, reportId, status, note } = input;
  const context = await requireReviewer(serverId, actorId);
  const report = await loadReviewableCase(serverId, actorId, reportId);
  if (report.status !== "open" && report.status !== "escalated") {
    throw new ReportActionError(409, "Report was already handled");
  }

  const action = status === "resolved" ? input.action ?? "none" : null;
  let targetMemberId: string | null = null;
  if (action === "warned" && !note) {
    throw new ReportActionError(400, "A warning needs a note the member will read");
  }
  if (action === "message_deleted" && !hasPermission("MANAGE_MESSAGES", context)) {
    throw new ReportActionError(403, "You need Manage Messages to remove the message");
  }
  if (action === "kicked" || action === "banned") {
    const perm: PermKey = action === "kicked" ? "KICK_MEMBERS" : "BAN_MEMBERS";
    if (!hasPermission(perm, context)) {
      throw new ReportActionError(403, `You need ${action === "kicked" ? "Kick" : "Ban"} Members for that action`);
    }
    const [actor, target] = await Promise.all([
      getMemberHierarchyIdentity(serverId, actorId),
      getMemberHierarchyIdentity(serverId, report.targetUserId),
    ]);
    if (!target?.member) throw new ReportActionError(409, "They are no longer a member of this camp");
    if (!actor || !actorOutranksTarget(actor, target)) {
      throw new ReportActionError(403, "You can't act on this member");
    }
    targetMemberId = target.member.id;
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const closed = await applyClose({
      tx,
      report,
      actorId,
      status,
      action,
      note,
      contextName: "the camp",
    });
    if (!closed) return null;

    let deleted: DeletableMessage[] = [];
    let channelId: string | null = null;
    if (action === "message_deleted") {
      ({ deleted, channelId } = await deleteEvidenceMessage(tx, report.messageId));
    } else if (action === "kicked") {
      // The ServerMember row is the only ban record: kicking a banned member
      // would lift the ban, so the check is part of the delete.
      const removed = await tx.serverMember.deleteMany({ where: { id: targetMemberId!, banned: false } });
      if (removed.count === 0) throw new ReportActionError(409, "Member is banned — unban first");
      await tx.auditLog.create({
        data: { serverId, actorId, targetId: report.targetUserId, action: "member_kick" },
      });
    } else if (action === "banned") {
      await tx.serverMember.update({
        where: { id: targetMemberId! },
        data: { banned: true, bannedAt: new Date() },
      });
      await tx.auditLog.create({
        data: { serverId, actorId, targetId: report.targetUserId, action: "member_ban" },
      });
    }
    return { ...closed, deleted, channelId };
  });
  if (!outcome) throw new ReportActionError(409, "Report was already handled");

  if (outcome.deleted.length > 0) await cleanupDeletedMessageUploads(outcome.deleted);
  if (action === "kicked" || action === "banned") {
    await notifyRealtimeAuthorizationChange({ scope: "member", serverId, userId: report.targetUserId });
  }
  for (const notification of outcome.notifications) emitNotification(notification.userId, notification);

  return {
    report: { id: report.id, status, action },
    deletedMessageIds: outcome.deleted.map((message) => message.id),
    channelId: outcome.channelId,
  };
}

// ───────────────────────────── appeals ─────────────────────────────

export interface AppealView {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  decisionNote: string | null;
  decidedAt: string | null;
}

function toAppealView(appeal: {
  id: string;
  status: string;
  reason: string;
  createdAt: Date;
  decisionNote: string | null;
  decidedAt: Date | null;
}): AppealView {
  return {
    id: appeal.id,
    status: appeal.status,
    reason: appeal.reason,
    createdAt: appeal.createdAt.toISOString(),
    decisionNote: appeal.decisionNote,
    decidedAt: appeal.decidedAt?.toISOString() ?? null,
  };
}

function appealWindowOpen(resolvedAt: Date | null, now: Date): boolean {
  return !!resolvedAt && resolvedAt.getTime() + APPEAL_WINDOW_MS > now.getTime();
}

/** The reported member appeals a resolution that acted on them — once, within the window. */
export async function fileReportAppeal(input: {
  userId: string;
  reportId: string;
  reason: string;
  now?: Date;
}): Promise<AppealView> {
  const { userId, reportId, reason } = input;
  const now = input.now ?? new Date();
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: { id: true, targetUserId: true, status: true, resolution: true, resolvedAt: true, appeal: { select: { id: true } } },
  });
  // Only the reported member learns the report exists.
  if (!report || report.targetUserId !== userId) throw new ReportActionError(404, "Nothing to appeal");
  if (report.status !== "resolved" || !report.resolution || report.resolution === "none") {
    throw new ReportActionError(409, "Nothing to appeal");
  }
  if (report.appeal) throw new ReportActionError(409, "You already appealed this");
  if (!appealWindowOpen(report.resolvedAt, now)) {
    throw new ReportActionError(409, "The appeal window has closed");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const appeal = await tx.reportAppeal.create({
        data: { reportId: report.id, appellantId: userId, reason },
      });
      await tx.reportEvent.create({
        data: { reportId: report.id, actorId: userId, type: "appeal_filed", detail: reason },
      });
      return toAppealView(appeal);
    });
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") throw new ReportActionError(409, "You already appealed this");
    throw error;
  }
}

/**
 * Decide an open appeal. The ranger who resolved the report can't judge their
 * own call (the owner can, so a one-moderator camp is never stuck). Accepting a
 * ban lifts it.
 */
export async function decideReportAppeal(input: {
  serverId: string;
  actorId: string;
  reportId: string;
  decision: AppealDecision;
  note: string | null;
}): Promise<AppealView> {
  const { serverId, actorId, reportId, decision, note } = input;
  const context = await requireReviewer(serverId, actorId);
  const report = await loadReviewableCase(serverId, actorId, reportId);
  if (!report.appeal || report.appeal.status !== "open") {
    throw new ReportActionError(409, "No open appeal on this report");
  }
  if (report.resolvedById === actorId && !context.isOwner) {
    throw new ReportActionError(403, "The ranger who resolved this report can't decide its appeal");
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const decided = await tx.reportAppeal.updateMany({
      where: { id: report.appeal!.id, status: "open" },
      data: { status: decision, decidedById: actorId, decisionNote: note, decidedAt: new Date() },
    });
    if (decided.count === 0) return null;
    await tx.reportEvent.create({
      data: { reportId: report.id, actorId, type: `appeal_${decision}`, detail: note },
    });
    await tx.auditLog.create({
      data: {
        serverId,
        actorId,
        targetId: null,
        action: decision === "accepted" ? "appeal_accept" : "appeal_reject",
        detail: `Appeal on report ${report.id} ${decision}`,
      },
    });

    let unbanned = false;
    if (decision === "accepted" && report.resolution === "banned") {
      const lifted = await tx.serverMember.updateMany({
        where: { serverId, userId: report.targetUserId, banned: true },
        data: { banned: false, bannedAt: null },
      });
      if (lifted.count > 0) {
        unbanned = true;
        await tx.auditLog.create({
          data: { serverId, actorId, targetId: report.targetUserId, action: "member_unban" },
        });
      }
    }

    const where = report.server?.name ?? "the camp";
    const notification = await createSimpleNotification({
      userId: report.targetUserId,
      type: "moderation",
      title: `Appeal ${decision} · ${where}`,
      body: decision === "accepted"
        ? `${unbanned ? "Your ban was lifted. " : ""}${note ?? "A moderator accepted your appeal."}`
        : note ?? "A moderator reviewed your appeal and upheld the decision.",
      serverId,
    }, tx);
    const appeal = await tx.reportAppeal.findUniqueOrThrow({ where: { id: report.appeal!.id } });
    return { appeal, unbanned, notification };
  });
  if (!outcome) throw new ReportActionError(409, "No open appeal on this report");

  if (outcome.unbanned) {
    await notifyRealtimeAuthorizationChange({ scope: "member", serverId, userId: report.targetUserId });
  }
  emitNotification(outcome.notification.userId, outcome.notification);
  return toAppealView(outcome.appeal);
}

export interface ModerationNoticeView {
  reportId: string;
  serverName: string | null;
  channelName: string | null;
  action: string;
  note: string | null;
  resolvedAt: string;
  canAppeal: boolean;
  appeal: AppealView | null;
}

/** What moderation has done about this member: resolutions with an action, newest first. */
export async function listModerationNotices(userId: string, now = new Date()): Promise<ModerationNoticeView[]> {
  const rows = await prisma.report.findMany({
    where: { targetUserId: userId, status: "resolved", resolution: { not: "none" }, resolvedAt: { not: null } },
    orderBy: [{ resolvedAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      resolution: true,
      resolutionNote: true,
      resolvedAt: true,
      evidenceChannelName: true,
      server: { select: { name: true } },
      appeal: true,
    },
  });
  return rows
    .filter((row) => row.resolution && row.resolvedAt)
    .map((row) => ({
      reportId: row.id,
      serverName: row.server?.name ?? null,
      channelName: row.evidenceChannelName,
      action: row.resolution!,
      note: row.resolutionNote,
      resolvedAt: row.resolvedAt!.toISOString(),
      canAppeal: !row.appeal && appealWindowOpen(row.resolvedAt, now),
      appeal: row.appeal ? toAppealView(row.appeal) : null,
    }));
}

// ───────────────────────────── instance operator ─────────────────────────────

export interface OperatorReportView {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  reporter: { username: string };
  targetUser: { username: string };
  serverName: string | null;
  messageDeleted: boolean;
  evidence: { channelName: string | null; snippet: string } | null;
  escalation: { at: string; note: string | null } | null;
}

/**
 * Instance-operator view: open reports no server desk can see (no community
 * context) and reports a desk escalated.
 */
export async function listOperatorReports(limit = 50): Promise<{ unscoped: OperatorReportView[]; escalated: OperatorReportView[] }> {
  const rows = await prisma.report.findMany({
    where: { OR: [{ status: "escalated" }, { status: "open", serverId: null }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit * 2,
    select: {
      id: true,
      status: true,
      reason: true,
      messageId: true,
      createdAt: true,
      escalatedAt: true,
      escalationNote: true,
      evidenceChannelName: true,
      evidenceContent: true,
      reporter: { select: { username: true } },
      targetUser: { select: { username: true } },
      server: { select: { name: true } },
    },
  });
  const messageIds = rows.map((r) => r.messageId).filter((id): id is string => !!id);
  const surviving = messageIds.length > 0
    ? new Set((await prisma.message.findMany({ where: { id: { in: messageIds } }, select: { id: true } })).map((m) => m.id))
    : new Set<string>();
  const views = rows.map((row) => ({
    id: row.id,
    status: row.status,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    reporter: row.reporter,
    targetUser: row.targetUser,
    serverName: row.server?.name ?? null,
    messageDeleted: !!row.messageId && !surviving.has(row.messageId),
    evidence: row.messageId
      ? { channelName: row.evidenceChannelName, snippet: snippetOf(row.evidenceContent ?? "") }
      : null,
    escalation: row.escalatedAt ? { at: row.escalatedAt.toISOString(), note: row.escalationNote } : null,
  }));
  return {
    unscoped: views.filter((view) => view.status === "open").slice(0, limit),
    escalated: views.filter((view) => view.status === "escalated").slice(0, limit),
  };
}

/** Operator close: no member actions (the operator may not be a member), but the message can go. */
export async function closeOperatorReport(input: {
  actorId: string;
  reportId: string;
  status: ReportResolution;
  action: ReportAction | null;
  note: string | null;
}): Promise<CloseReportResult> {
  const { actorId, reportId, status, note } = input;
  const action = status === "resolved" ? input.action ?? "none" : null;
  if (action && !OPERATOR_ACTIONS.includes(action)) {
    throw new ReportActionError(400, "The operator can only record no action or remove the message");
  }
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: { server: { select: { id: true, name: true } } },
  });
  const operatorCanSee = report && (report.serverId === null || report.status === "escalated");
  if (!report || !operatorCanSee) throw new ReportActionError(404, "Report not found");
  if (report.status !== "open" && report.status !== "escalated") {
    throw new ReportActionError(409, "Report was already handled");
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const closed = await applyClose({ tx, report, actorId, status, action, note, contextName: "the instance operator" });
    if (!closed) return null;
    const removal = action === "message_deleted"
      ? await deleteEvidenceMessage(tx, report.messageId)
      : { deleted: [], channelId: null };
    return { ...closed, ...removal };
  });
  if (!outcome) throw new ReportActionError(409, "Report was already handled");

  if (outcome.deleted.length > 0) await cleanupDeletedMessageUploads(outcome.deleted);
  for (const notification of outcome.notifications) emitNotification(notification.userId, notification);
  return {
    report: { id: report.id, status, action },
    deletedMessageIds: outcome.deleted.map((message) => message.id),
    channelId: outcome.channelId,
  };
}

/** Both people must share this community for a user-level report to be filed in it. */
export async function usersShareServer(serverId: string, userA: string, userB: string): Promise<boolean> {
  const server = await prisma.server.findUnique({ where: { id: serverId }, select: { ownerId: true } });
  if (!server) return false;
  const isIn = async (userId: string) => server.ownerId === userId || !!(await requireMembership(serverId, userId));
  return (await isIn(userA)) && (await isIn(userB));
}

export interface OperatorMessageReportView {
  id: string;
  status: ReportStatus;
  reason: string;
  createdAt: string;
  reporter: { username: string };
  targetUser: { username: string };
  message: {
    id: string;
    snippet: string;
    channelName: string | null;
    serverName: string | null;
    deleted: boolean;
  };
}

/**
 * Instance-operator view of the message reports camp moderators handle: every
 * one filed in the last 30 days, whatever its status, so illegal content
 * reaches the operator even when a camp's own moderators dismiss the report
 * (Terms section 8: "we can see it too"). Reads the evidence snapshot, so a
 * message the camp already removed still shows what was reported.
 */
export async function listRecentMessageReports(now = new Date(), limit = 100): Promise<OperatorMessageReportView[]> {
  const rows = await prisma.report.findMany({
    where: { messageId: { not: null }, createdAt: { gte: new Date(now.getTime() - RECENT_HANDLED_MS) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      id: true,
      reason: true,
      status: true,
      messageId: true,
      createdAt: true,
      evidenceContent: true,
      evidenceChannelName: true,
      reporter: { select: { username: true } },
      targetUser: { select: { username: true } },
      server: { select: { name: true } },
    },
  });
  const messageIds = rows.map((row) => row.messageId).filter((id): id is string => !!id);
  const surviving = messageIds.length > 0
    ? new Set((await prisma.message.findMany({ where: { id: { in: messageIds } }, select: { id: true } })).map((m) => m.id))
    : new Set<string>();
  return rows.map((row) => ({
    id: row.id,
    status: row.status as ReportStatus,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    reporter: row.reporter,
    targetUser: row.targetUser,
    message: {
      id: row.messageId!,
      snippet: snippetOf(row.evidenceContent ?? ""),
      channelName: row.evidenceChannelName,
      serverName: row.server?.name ?? null,
      deleted: !surviving.has(row.messageId!),
    },
  }));
}
