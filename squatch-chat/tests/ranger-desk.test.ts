import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

// Ranger Desk beyond the queue: assignment, escalation, resolutions that act on
// the member, evidence that outlives the message, appeals, member notices, and
// the instance-operator desk. Session is stubbed; everything else hits the test DB.

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET as listRoute } from "@/app/api/servers/[serverId]/reports/route";
import { GET as caseRoute, PATCH as patchRoute } from "@/app/api/servers/[serverId]/reports/[reportId]/route";
import { PATCH as decideRoute } from "@/app/api/servers/[serverId]/reports/[reportId]/appeal/route";
import { POST as appealRoute } from "@/app/api/reports/[reportId]/appeal/route";
import { GET as noticesRoute } from "@/app/api/reports/notices/route";
import { PATCH as operatorRoute } from "@/app/api/admin/reports/[reportId]/route";
import { evidenceFromMessage, listOperatorReports } from "@/lib/reports";

const tag = Math.random().toString(36).slice(2, 8);

type U = { id: string; username: string };
let owner: U, admin: U, modA: U, modB: U, member: U, offender: U, offender2: U, reporter: U;
let serverId: string;
let generalId: string;
let secretId: string;

const messageSelect = {
  id: true,
  content: true,
  attachmentName: true,
  attachmentUrl: true,
  channelId: true,
  createdAt: true,
  channel: { select: { name: true, serverId: true } },
} as const;

function signIn(user: U) {
  authMock.getSession.mockResolvedValue({ userId: user.id, username: user.username });
}

async function postMessage(channelId: string, authorId: string, content: string, parentMessageId?: string) {
  return prisma.message.create({ data: { channelId, authorId, content, parentMessageId }, select: messageSelect });
}

async function fileReport(targetUserId: string, message: Awaited<ReturnType<typeof postMessage>> | null, reason: string, reporterId = reporter.id) {
  const report = await prisma.report.create({
    data: {
      reporterId,
      targetUserId,
      messageId: message?.id ?? null,
      reason,
      ...(message ? evidenceFromMessage(message) : { serverId }),
    },
    select: { id: true },
  });
  await prisma.reportEvent.create({ data: { reportId: report.id, actorId: reporterId, type: "filed" } });
  return report.id;
}

function list(include?: "recent") {
  return listRoute(
    new NextRequest(`http://test.local/api/servers/${serverId}/reports${include ? "?include=recent" : ""}`),
    { params: Promise.resolve({ serverId }) },
  ).then((res) => res.json());
}

function getCase(reportId: string) {
  return caseRoute(new NextRequest(`http://test.local/api/servers/${serverId}/reports/${reportId}`), {
    params: Promise.resolve({ serverId, reportId }),
  });
}

function patch(reportId: string, body: unknown) {
  return patchRoute(
    new NextRequest(`http://test.local/api/servers/${serverId}/reports/${reportId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ serverId, reportId }) },
  );
}

function decide(reportId: string, body: unknown) {
  return decideRoute(
    new NextRequest(`http://test.local/api/servers/${serverId}/reports/${reportId}/appeal`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ serverId, reportId }) },
  );
}

function appeal(reportId: string, reason: string) {
  return appealRoute(
    new NextRequest(`http://test.local/api/reports/${reportId}/appeal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason }),
    }),
    { params: Promise.resolve({ reportId }) },
  );
}

function operatorPatch(reportId: string, body: unknown) {
  return operatorRoute(
    new NextRequest(`http://test.local/api/admin/reports/${reportId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ reportId }) },
  );
}

function notificationsFor(userId: string, type: string) {
  return prisma.notification.findMany({ where: { userId, type }, orderBy: { createdAt: "asc" } });
}

beforeAll(async () => {
  [owner, admin, modA, modB, member, offender, offender2, reporter] = await Promise.all(
    ["owner", "admin", "modA", "modB", "member", "offender", "offender2", "reporter"].map((name) =>
      prisma.user.create({
        data: { email: `rd-${name}-${tag}@t.local`, username: `rd_${name}_${tag}`, passwordHash: "x" },
        select: { id: true, username: true },
      }),
    ),
  );
  const server = await prisma.server.create({
    data: {
      name: "Ranger Camp",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: admin.id, role: "admin" },
          { userId: modA.id, role: "mod" },
          { userId: modB.id, role: "mod" },
          { userId: member.id, role: "member" },
          { userId: offender.id, role: "member" },
          { userId: offender2.id, role: "member" },
          { userId: reporter.id, role: "member" },
        ],
      },
    },
  });
  serverId = server.id;
  const [general, secret] = await Promise.all([
    prisma.channel.create({ data: { serverId, name: "general" } }),
    prisma.channel.create({ data: { serverId, name: "secret" } }),
  ]);
  generalId = general.id;
  secretId = secret.id;
  await prisma.channelPermission.create({ data: { channelId: secretId, role: "mod", canView: false, canSend: false } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("assignment", () => {
  let reportId: string;

  beforeAll(async () => {
    const message = await postMessage(generalId, offender.id, "assign me");
    reportId = await fileReport(offender.id, message, "needs a ranger");
  });

  it("assigns to a reviewer, records it, and unassigns", async () => {
    signIn(modA);
    const res = await patch(reportId, { assigneeId: modB.id });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ report: { id: reportId, assignee: { id: modB.id, username: modB.username } } });
    expect(await prisma.report.findUnique({ where: { id: reportId }, select: { assigneeId: true } })).toEqual({ assigneeId: modB.id });
    expect(await prisma.auditLog.count({ where: { serverId, action: "report_assign", actorId: modA.id } })).toBe(1);

    const queue = await list();
    expect(queue.reports.find((r: { id: string }) => r.id === reportId).assignee).toEqual({ id: modB.id, username: modB.username });

    expect((await patch(reportId, { assigneeId: null })).status).toBe(200);
    expect(await prisma.report.findUnique({ where: { id: reportId }, select: { assigneeId: true } })).toEqual({ assigneeId: null });

    const detail = await (await getCase(reportId)).json();
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(["filed", "assigned", "unassigned"]);
    expect(detail.events[1]).toMatchObject({ actor: { id: modA.id }, detail: `Assigned to ${modB.username}` });
  });

  it("only assigns to someone who could review the report themselves", async () => {
    signIn(modA);
    expect((await patch(reportId, { assigneeId: member.id })).status).toBe(400); // no moderation permission
    expect((await patch(reportId, { assigneeId: offender.id })).status).toBe(400); // the target
    expect((await patch(reportId, { assigneeId: "nobody" })).status).toBe(400);
    expect((await patch(reportId, { assigneeId: modB.id, status: "dismissed" })).status).toBe(400); // one thing at a time

    // A hidden-channel report can't be handed to a mod who can't see the channel.
    const hidden = await postMessage(secretId, offender.id, "hidden");
    const hiddenReport = await fileReport(offender.id, hidden, "hidden channel");
    signIn(owner);
    expect((await patch(hiddenReport, { assigneeId: modA.id })).status).toBe(400);
    expect((await patch(hiddenReport, { assigneeId: admin.id })).status).toBe(200);
  });
});

describe("escalation", () => {
  let reportId: string;

  beforeAll(async () => {
    const message = await postMessage(generalId, offender.id, "escalate me");
    reportId = await fileReport(offender.id, message, "beyond this camp");
  });

  it("hands an open report to the operator and keeps it on the desk", async () => {
    signIn(modA);
    const res = await patch(reportId, { status: "escalated", note: "cross-camp spam ring" });
    expect(res.status).toBe(200);
    expect(await prisma.report.findUnique({ where: { id: reportId } })).toMatchObject({
      status: "escalated",
      escalatedById: modA.id,
      escalationNote: "cross-camp spam ring",
    });
    expect((await patch(reportId, { status: "escalated" })).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { serverId, action: "report_escalate" } })).toBe(1);

    const queue = await list();
    const row = queue.reports.find((r: { id: string }) => r.id === reportId);
    expect(row).toMatchObject({ status: "escalated", needsAttention: true, escalation: { by: { id: modA.id }, note: "cross-camp spam ring" } });

    const { escalated } = await listOperatorReports();
    expect(escalated.map((r) => r.id)).toContain(reportId);
    expect(escalated.find((r) => r.id === reportId)).toMatchObject({ serverName: "Ranger Camp", escalation: { note: "cross-camp spam ring" } });

    // The desk can still close it; the operator then no longer sees it.
    signIn(modB);
    expect((await patch(reportId, { status: "dismissed", note: "handled locally after all" })).status).toBe(200);
    expect((await listOperatorReports()).escalated.map((r) => r.id)).not.toContain(reportId);
  });
});

describe("resolution actions", () => {
  it("removing the message deletes it with its thread and notifies both sides", async () => {
    const parent = await postMessage(generalId, offender.id, "the offending post");
    const reply = await postMessage(generalId, member.id, "a reply in the thread", parent.id);
    const reportId = await fileReport(offender.id, parent, "please remove this");

    signIn(modA);
    const res = await patch(reportId, { status: "resolved", action: "message_deleted", note: "breaks rule 2" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.report).toEqual({ id: reportId, status: "resolved", action: "message_deleted" });
    expect(body.channelId).toBe(generalId);
    expect(body.deletedMessageIds.sort()).toEqual([parent.id, reply.id].sort());
    expect(await prisma.message.count({ where: { id: { in: [parent.id, reply.id] } } })).toBe(0);

    const [notice] = await notificationsFor(offender.id, "moderation");
    expect(notice).toMatchObject({ serverId, title: "Moderation notice · Ranger Camp" });
    expect(notice.body).toContain("removed your message in #general");
    expect(notice.body).toContain("Reason: breaks rule 2");
    expect((await notificationsFor(reporter.id, "report_update")).at(-1)?.body).toContain("took action on your report");

    // The evidence snapshot outlives the message.
    const queue = await list("recent");
    const row = queue.reports.find((r: { id: string }) => r.id === reportId);
    expect(row).toMatchObject({
      status: "resolved",
      needsAttention: false,
      message: { id: parent.id, content: "the offending post", deleted: true },
      resolution: { action: "message_deleted", note: "breaks rule 2", by: { id: modA.id } },
    });
    const audit = await prisma.auditLog.findFirst({ where: { serverId, action: "report_resolve", actorId: modA.id } });
    expect(audit?.detail).toContain("(message_deleted)");
  });

  it("a warning needs a note the member will read", async () => {
    const message = await postMessage(generalId, offender.id, "borderline");
    const reportId = await fileReport(offender.id, message, "tone");
    signIn(modA);
    expect((await patch(reportId, { status: "resolved", action: "warned" })).status).toBe(400);
    expect((await patch(reportId, { status: "resolved", action: "warned", note: "keep it civil" })).status).toBe(200);
    const notices = await notificationsFor(offender.id, "moderation");
    expect(notices.at(-1)?.body).toContain("issued you a warning. Reason: keep it civil");
    expect(await prisma.message.count({ where: { id: message.id } })).toBe(1); // a warning removes nothing
  });

  it("kicks and bans follow the member routes' permission and hierarchy rules", async () => {
    signIn(modA);
    // A mod can't act on an admin (hierarchy) and holds no BAN_MEMBERS (permission).
    const adminMsg = await postMessage(generalId, admin.id, "admin said something");
    const adminReport = await fileReport(admin.id, adminMsg, "admin is rude");
    expect((await patch(adminReport, { status: "resolved", action: "kicked" })).status).toBe(403);
    const banTry = await postMessage(generalId, offender.id, "ban me?");
    const banReport = await fileReport(offender.id, banTry, "needs a ban");
    expect((await patch(banReport, { status: "resolved", action: "banned" })).status).toBe(403);
    expect(await prisma.report.findUnique({ where: { id: banReport }, select: { status: true } })).toEqual({ status: "open" });

    // A mod can kick a plain member …
    const kickMsg = await postMessage(generalId, offender.id, "kick me");
    const kickReport = await fileReport(offender.id, kickMsg, "needs a kick");
    expect((await patch(kickReport, { status: "resolved", action: "kicked", note: "cool off" })).status).toBe(200);
    expect(await prisma.serverMember.count({ where: { serverId, userId: offender.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { serverId, action: "member_kick", targetId: offender.id } })).toBe(1);
    expect((await notificationsFor(offender.id, "moderation")).at(-1)?.body).toContain("You were removed from Ranger Camp. Reason: cool off");
    // … and once they're gone, kick/ban resolutions on them are a 409, never a silent "none".
    expect((await patch(banReport, { status: "resolved", action: "kicked" })).status).toBe(409);

    // An admin can ban.
    signIn(admin);
    const banMsg = await postMessage(generalId, offender2.id, "really bad");
    const banReport2 = await fileReport(offender2.id, banMsg, "ban-worthy");
    expect((await patch(banReport2, { status: "resolved", action: "banned", note: "repeated harassment" })).status).toBe(200);
    expect(await prisma.serverMember.findUnique({ where: { serverId_userId: { serverId, userId: offender2.id } }, select: { banned: true } }))
      .toEqual({ banned: true });
    expect(await prisma.auditLog.count({ where: { serverId, action: "member_ban", targetId: offender2.id } })).toBe(1);
  });

  it("dismissing tells the reporter and nobody else; a deleted channel no longer hides a case", async () => {
    const hidden = await postMessage(secretId, member.id, "secret rant");
    const reportId = await fileReport(member.id, hidden, "in the secret channel");
    signIn(modA);
    expect((await list()).reports.map((r: { id: string }) => r.id)).not.toContain(reportId);

    // Channel gone (messages first — the FK blocks otherwise): the snapshot is all that is left.
    await prisma.message.deleteMany({ where: { channelId: secretId } });
    await prisma.channel.delete({ where: { id: secretId } });
    const visible = (await list()).reports.find((r: { id: string }) => r.id === reportId);
    expect(visible).toMatchObject({ message: { content: "secret rant", channelName: "secret", deleted: true } });

    const before = (await notificationsFor(member.id, "moderation")).length;
    expect((await patch(reportId, { status: "dismissed", note: "not a violation" })).status).toBe(200);
    expect((await notificationsFor(member.id, "moderation")).length).toBe(before);
    expect((await notificationsFor(reporter.id, "report_update")).at(-1)?.body).toContain("closed it without action");
  });
});

describe("appeals", () => {
  let bannedReportId: string;

  beforeAll(async () => {
    // offender2 was banned above by admin; find that case.
    const row = await prisma.report.findFirst({ where: { targetUserId: offender2.id, resolution: "banned" }, select: { id: true } });
    bannedReportId = row!.id;
  });

  it("only the reported member can appeal, once, within the window, on a real action", async () => {
    signIn(member);
    expect((await appeal(bannedReportId, "I was not even there, honest")).status).toBe(404);

    signIn(offender2);
    expect((await appeal(bannedReportId, "short")).status).toBe(400);
    const res = await appeal(bannedReportId, "That was taken out of context; I apologised in the thread.");
    expect(res.status).toBe(201);
    expect((await res.json()).appeal).toMatchObject({ status: "open" });
    expect((await appeal(bannedReportId, "Trying a second time regardless")).status).toBe(409);

    // Nothing to appeal on a "no action" resolution, and the window closes after 14 days.
    const noneMsg = await postMessage(generalId, offender2.id, "nothing much");
    const noneReport = await fileReport(offender2.id, noneMsg, "meh");
    signIn(modB);
    expect((await patch(noneReport, { status: "resolved", action: "none" })).status).toBe(200);
    signIn(offender2);
    expect((await appeal(noneReport, "appealing a non-action for some reason")).status).toBe(409);

    const staleMsg = await postMessage(generalId, offender2.id, "long ago");
    const staleReport = await fileReport(offender2.id, staleMsg, "old case");
    signIn(modB);
    expect((await patch(staleReport, { status: "resolved", action: "warned", note: "old warning" })).status).toBe(200);
    await prisma.report.update({ where: { id: staleReport }, data: { resolvedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) } });
    signIn(offender2);
    expect((await appeal(staleReport, "appealing well past the window")).status).toBe(409);

    const notices = await (await noticesRoute()).json();
    const bannedNotice = notices.notices.find((n: { reportId: string }) => n.reportId === bannedReportId);
    expect(bannedNotice).toMatchObject({ action: "banned", serverName: "Ranger Camp", note: "repeated harassment", canAppeal: false, appeal: { status: "open" } });
    expect(notices.notices.find((n: { reportId: string }) => n.reportId === staleReport)).toMatchObject({ canAppeal: false, appeal: null });
    expect(notices.notices.map((n: { reportId: string }) => n.reportId)).not.toContain(noneReport);
    expect(JSON.stringify(notices)).not.toContain(reporter.username); // never who reported them
  });

  it("the resolver can't judge their own call; accepting lifts the ban and tells the member", async () => {
    signIn(modA);
    const queue = await list();
    const pending = queue.reports.find((r: { id: string }) => r.id === bannedReportId);
    expect(pending).toMatchObject({ status: "resolved", needsAttention: true, appeal: { status: "open" } });
    expect(queue.openCount).toBeGreaterThanOrEqual(1);

    signIn(admin); // resolved it
    expect((await decide(bannedReportId, { decision: "accepted" })).status).toBe(403);
    signIn(member);
    expect((await decide(bannedReportId, { decision: "accepted" })).status).toBe(403);
    signIn(modA);
    expect((await decide(bannedReportId, { decision: "maybe" })).status).toBe(400);

    const res = await decide(bannedReportId, { decision: "accepted", note: "Fair enough, welcome back." });
    expect(res.status).toBe(200);
    expect((await res.json()).appeal).toMatchObject({ status: "accepted", decisionNote: "Fair enough, welcome back." });
    expect(await prisma.serverMember.findUnique({ where: { serverId_userId: { serverId, userId: offender2.id } }, select: { banned: true, bannedAt: true } }))
      .toEqual({ banned: false, bannedAt: null });
    expect(await prisma.auditLog.count({ where: { serverId, action: "member_unban", targetId: offender2.id, actorId: modA.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { serverId, action: "appeal_accept" } })).toBe(1);
    const notice = (await notificationsFor(offender2.id, "moderation")).at(-1);
    expect(notice).toMatchObject({ title: "Appeal accepted · Ranger Camp" });
    expect(notice?.body).toContain("Your ban was lifted. Fair enough, welcome back.");
    expect((await decide(bannedReportId, { decision: "rejected" })).status).toBe(409);

    const detail = await (await getCase(bannedReportId)).json();
    expect(detail.events.map((e: { type: string }) => e.type)).toEqual(["filed", "resolved", "appeal_filed", "appeal_accepted"]);
    expect((await list()).reports.find((r: { id: string }) => r.id === bannedReportId)).toBeUndefined(); // nothing left to do
  });

  it("the owner may decide an appeal on their own resolution, and a rejection stands", async () => {
    // `offender` (kicked earlier, so no longer a member) still gets notices and can appeal.
    const msg = await postMessage(generalId, offender.id, "owner handles this");
    const reportId = await fileReport(offender.id, msg, "owner case");
    signIn(owner);
    expect((await patch(reportId, { status: "resolved", action: "warned", note: "last chance" })).status).toBe(200);
    signIn(offender);
    expect((await appeal(reportId, "I disagree with the warning entirely")).status).toBe(201);
    signIn(owner);
    const res = await decide(reportId, { decision: "rejected", note: "The warning stands." });
    expect(res.status).toBe(200);
    expect((await res.json()).appeal).toMatchObject({ status: "rejected" });
    expect((await notificationsFor(offender.id, "moderation")).at(-1)).toMatchObject({ title: "Appeal rejected · Ranger Camp", body: "The warning stands." });
  });
});

describe("instance operator", () => {
  const previousAllowlist = process.env.INSTANCE_ADMIN_USER_IDS;
  let operator: U;
  let escalatedId: string;
  let unscopedId: string;
  let scopedId: string;

  beforeAll(async () => {
    operator = await prisma.user.create({
      data: { email: `rd-operator-${tag}@t.local`, username: `rd_operator_${tag}`, passwordHash: "x" },
      select: { id: true, username: true },
    });
    process.env.INSTANCE_ADMIN_USER_IDS = operator.id;
    const m1 = await postMessage(generalId, member.id, "escalated to the operator");
    escalatedId = await fileReport(member.id, m1, "operator please");
    signIn(modA);
    expect((await patch(escalatedId, { status: "escalated", note: "needs the operator" })).status).toBe(200);
    const m2 = await postMessage(generalId, member.id, "pre-desk report");
    // A report filed before Ranger Desk whose message is gone: no community to backfill from.
    unscopedId = (await prisma.report.create({
      data: { reporterId: reporter.id, targetUserId: member.id, messageId: m2.id, reason: "legacy, message deleted" },
      select: { id: true },
    })).id;
    await prisma.message.delete({ where: { id: m2.id } });
    const m3 = await postMessage(generalId, member.id, "an ordinary open report");
    scopedId = await fileReport(member.id, m3, "ordinary");
  });

  afterAll(() => {
    process.env.INSTANCE_ADMIN_USER_IDS = previousAllowlist;
  });

  it("sees escalated and community-less reports, never ordinary ones", async () => {
    const { escalated, unscoped } = await listOperatorReports();
    expect(escalated.map((r) => r.id)).toContain(escalatedId);
    expect(unscoped.map((r) => r.id)).toContain(unscopedId);
    expect(unscoped.find((r) => r.id === unscopedId)).toMatchObject({ messageDeleted: true, serverName: null });
    expect([...escalated, ...unscoped].map((r) => r.id)).not.toContain(scopedId);
    signIn(modA);
    expect((await list()).reports.map((r: { id: string }) => r.id)).not.toContain(unscopedId);
  });

  it("closes only what it can see, as the allowlisted operator", async () => {
    signIn(owner); // not allowlisted
    expect((await operatorPatch(escalatedId, { status: "dismissed" })).status).toBe(404);

    signIn(operator);
    expect((await operatorPatch(scopedId, { status: "dismissed" })).status).toBe(404);
    expect((await operatorPatch(escalatedId, { status: "resolved", action: "banned" })).status).toBe(400);
    const res = await operatorPatch(escalatedId, { status: "resolved", action: "message_deleted", note: "operator removed it" });
    expect(res.status).toBe(200);
    expect((await res.json()).deletedMessageIds).toHaveLength(1);
    expect(await prisma.report.findUnique({ where: { id: escalatedId }, select: { status: true, resolvedById: true } }))
      .toEqual({ status: "resolved", resolvedById: operator.id });
    expect((await notificationsFor(member.id, "moderation")).at(-1)?.body).toContain("removed your message in #general. Reason: operator removed it");

    expect((await operatorPatch(unscopedId, { status: "dismissed", note: "stale" })).status).toBe(200);
    expect((await notificationsFor(reporter.id, "report_update")).at(-1)?.body).toContain("the instance operator");
    expect((await operatorPatch(unscopedId, { status: "dismissed" })).status).toBe(409);
  });
});
