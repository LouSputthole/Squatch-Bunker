import { prisma } from "@/lib/db";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { hasPermission, type PermKey } from "@/lib/permissions";
import { getPermContext } from "@/lib/serverRoles";

/**
 * Ranger Desk — the per-server moderator view of abuse reports.
 *
 * Reports carry no server id, so server scope is derived from evidence only:
 * a report belongs to a server's desk when its message still exists in one of
 * that server's channels AND the reviewing moderator can view that channel.
 * User-level reports (no message) and reports whose message was deleted have
 * no provable server context — "both parties share a server" would let the
 * owner of any later-shared server read reports filed elsewhere — so they go
 * to the instance operator (app/admin) only.
 * A moderator never sees or acts on a report that targets themselves.
 */

export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_RESOLUTIONS = ["resolved", "dismissed"] as const;
export type ReportResolution = (typeof REPORT_RESOLUTIONS)[number];

/** Any of these lets a member review reports (mods hold the first two by default). */
export const REPORT_REVIEW_PERMISSIONS: PermKey[] = ["MANAGE_MESSAGES", "KICK_MEMBERS", "BAN_MEMBERS"];

const SNIPPET_LENGTH = 200;
const MAX_LISTED = 200;
const MAX_CANDIDATE_BATCHES = 10;
const RECENT_HANDLED_MS = 30 * 24 * 60 * 60 * 1000;

export function parseReportResolution(value: unknown): ReportResolution | null {
  return typeof value === "string" && (REPORT_RESOLUTIONS as readonly string[]).includes(value)
    ? (value as ReportResolution)
    : null;
}

export async function canReviewReports(serverId: string, userId: string): Promise<boolean> {
  const context = await getPermContext(serverId, userId);
  if (!context.isMember) return false;
  return REPORT_REVIEW_PERMISSIONS.some((perm) => hasPermission(perm, context));
}

interface ReportRow {
  targetUserId: string;
  messageId: string | null;
}

interface ReportCandidate extends ReportRow {
  id: string;
  status: string;
  reason: string;
  createdAt: Date;
  reporter: { id: string; username: string };
  targetUser: { id: string; username: string };
}

interface ScopedMessage {
  id: string;
  content: string;
  channelId: string;
  createdAt: Date;
  channel: { name: string };
}

/**
 * Keep the reports this viewer may review in this server, paired with their
 * message evidence. Channel access is resolved once per channel.
 */
async function scopeReportsForViewer<T extends ReportRow>(
  serverId: string,
  viewerId: string,
  reports: T[],
): Promise<Array<{ report: T; message: ScopedMessage }>> {
  const candidates = reports.filter((r) => r.messageId && r.targetUserId !== viewerId);
  const messageIds = [...new Set(candidates.map((r) => r.messageId!))];
  if (messageIds.length === 0) return [];

  const messages = await prisma.message.findMany({
    where: { id: { in: messageIds }, channel: { serverId } },
    select: {
      id: true,
      content: true,
      channelId: true,
      createdAt: true,
      channel: { select: { name: true } },
    },
  });
  const messageById = new Map(messages.map((message) => [message.id, message]));

  const canViewChannel = new Map<string, boolean>();
  const scoped: Array<{ report: T; message: ScopedMessage }> = [];
  for (const report of candidates) {
    const message = messageById.get(report.messageId!);
    if (!message) continue;
    let canView = canViewChannel.get(message.channelId);
    if (canView === undefined) {
      const access = await resolveChannelAccess(message.channelId, viewerId);
      canView = access?.canView === true && access.serverId === serverId;
      canViewChannel.set(message.channelId, canView);
    }
    if (canView) scoped.push({ report, message });
  }
  return scoped;
}

export async function viewerCanReviewReport(
  serverId: string,
  viewerId: string,
  report: ReportRow,
): Promise<boolean> {
  return (await scopeReportsForViewer(serverId, viewerId, [report])).length === 1;
}

function snippetOf(content: string): string {
  const collapsed = content.replace(/\s+/g, " ").trim();
  return collapsed.length > SNIPPET_LENGTH ? `${collapsed.slice(0, SNIPPET_LENGTH - 1)}…` : collapsed;
}

export interface ServerReportView {
  id: string;
  status: string;
  reason: string;
  createdAt: string;
  reporter: { id: string; username: string };
  target: { id: string; username: string };
  message: { id: string; channelId: string; channelName: string; snippet: string; createdAt: string };
}

/**
 * Open reports (plus, with includeRecent, ones filed in the last 30 days that
 * were since handled) on messages this viewer can see in this server.
 */
export async function listServerReports(
  serverId: string,
  viewerId: string,
  options: { includeRecent?: boolean; now?: Date } = {},
): Promise<{ reports: ServerReportView[]; openCount: number }> {
  const now = options.now ?? new Date();
  const statusFilter = options.includeRecent
    ? { OR: [{ status: "open" }, { createdAt: { gte: new Date(now.getTime() - RECENT_HANDLED_MS) } }] }
    : { status: "open" };

  // SQL narrows to message reports whose target posted in this server;
  // scopeReportsForViewer applies the exact message + channel-access rule. Report has
  // no message relation, so page through candidates until MAX_LISTED are visible —
  // otherwise reports from other servers/hidden channels could crowd out this queue.
  // ponytail: bounded batches; a Report.serverId column would make this one query.
  const where = {
    ...statusFilter,
    messageId: { not: null },
    targetUserId: { not: viewerId },
    targetUser: { messages: { some: { channel: { serverId } } } },
  };
  const scoped: Array<{ report: ReportCandidate; message: ScopedMessage }> = [];
  let cursor: string | undefined;
  for (let batch = 0; batch < MAX_CANDIDATE_BATCHES && scoped.length < MAX_LISTED; batch++) {
    const rows: ReportCandidate[] = await prisma.report.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_LISTED,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        reporter: { select: { id: true, username: true } },
        targetUser: { select: { id: true, username: true } },
      },
    });
    scoped.push(...(await scopeReportsForViewer(serverId, viewerId, rows)));
    if (rows.length < MAX_LISTED) break;
    cursor = rows[rows.length - 1].id;
  }

  const reports: ServerReportView[] = scoped.slice(0, MAX_LISTED)
    .map(({ report, message }) => ({
      id: report.id,
      status: report.status,
      reason: report.reason,
      createdAt: report.createdAt.toISOString(),
      reporter: report.reporter,
      target: report.targetUser,
      message: {
        id: message.id,
        channelId: message.channelId,
        channelName: message.channel.name,
        snippet: snippetOf(message.content),
        createdAt: message.createdAt.toISOString(),
      },
    }));

  // Open first, newest first within each group (sort is stable).
  reports.sort((a, b) => Number(b.status === "open") - Number(a.status === "open"));
  return { reports, openCount: reports.filter((r) => r.status === "open").length };
}

/**
 * Instance-operator view: open reports no server desk can see — user-level
 * reports and message reports whose message is gone.
 */
export async function listUnscopedOpenReports(limit = 50) {
  const open = await prisma.report.findMany({
    where: { status: "open" },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      id: true,
      reason: true,
      messageId: true,
      createdAt: true,
      reporter: { select: { username: true } },
      targetUser: { select: { username: true } },
    },
  });
  const messageIds = open.map((r) => r.messageId).filter((id): id is string => !!id);
  const surviving = messageIds.length > 0
    ? new Set((await prisma.message.findMany({
      where: { id: { in: messageIds } },
      select: { id: true },
    })).map((m) => m.id))
    : new Set<string>();
  return open
    .filter((r) => !r.messageId || !surviving.has(r.messageId))
    .slice(0, limit)
    .map((r) => ({ ...r, messageDeleted: !!r.messageId }));
}
