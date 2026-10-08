import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

// Ranger Desk: GET/PATCH /api/servers/:serverId/reports. Session is stubbed;
// everything else runs against the test DB.

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET } from "@/app/api/servers/[serverId]/reports/route";
import { PATCH } from "@/app/api/servers/[serverId]/reports/[reportId]/route";
import { listUnscopedOpenReports } from "@/lib/reports";

const tag = Math.random().toString(36).slice(2, 8);

type U = { id: string; username: string };
let owner: U, mod: U, member: U, offender: U, reporter: U;
let serverId: string;
let otherServerId: string;
let visibleReportId: string;
let hiddenReportId: string;
let selfReportId: string;
let userLevelReportId: string;
let foreignReportId: string;

function signIn(user: U) {
  authMock.getSession.mockResolvedValue({ userId: user.id, username: user.username });
}

function list(id = serverId) {
  return GET(new NextRequest(`http://test.local/api/servers/${id}/reports`), {
    params: Promise.resolve({ serverId: id }),
  });
}

function patch(reportId: string, status: unknown, id = serverId) {
  return PATCH(
    new NextRequest(`http://test.local/api/servers/${id}/reports/${reportId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ serverId: id, reportId }) },
  );
}

beforeAll(async () => {
  [owner, mod, member, offender, reporter] = await Promise.all(
    ["owner", "mod", "member", "offender", "reporter"].map((name) =>
      prisma.user.create({
        data: { email: `desk-${name}-${tag}@t.local`, username: `desk_${name}_${tag}`, passwordHash: "x" },
        select: { id: true, username: true },
      }),
    ),
  );
  const server = await prisma.server.create({
    data: {
      name: "Desk",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: mod.id, role: "mod" },
          { userId: member.id, role: "member" },
          { userId: offender.id, role: "member" },
          { userId: reporter.id, role: "member" },
        ],
      },
    },
  });
  serverId = server.id;
  const other = await prisma.server.create({
    data: {
      name: "Elsewhere",
      ownerId: offender.id,
      members: { create: [{ userId: offender.id, role: "owner" }, { userId: reporter.id, role: "member" }] },
    },
  });
  otherServerId = other.id;

  const [general, modsHidden, foreign] = await Promise.all([
    prisma.channel.create({ data: { serverId, name: "general" } }),
    prisma.channel.create({ data: { serverId, name: "secret-council" } }),
    prisma.channel.create({ data: { serverId: otherServerId, name: "foreign" } }),
  ]);
  await prisma.channelPermission.create({
    data: { channelId: modsHidden.id, role: "mod", canView: false, canSend: false },
  });

  const [visibleMsg, hiddenMsg, modMsg, foreignMsg] = await Promise.all([
    prisma.message.create({ data: { channelId: general.id, authorId: offender.id, content: "visible   abuse\nline" } }),
    prisma.message.create({ data: { channelId: modsHidden.id, authorId: offender.id, content: "hidden words" } }),
    prisma.message.create({ data: { channelId: general.id, authorId: mod.id, content: "mod being rude" } }),
    prisma.message.create({ data: { channelId: foreign.id, authorId: offender.id, content: "elsewhere" } }),
  ]);

  const make = (targetUserId: string, messageId: string | null, reason: string) =>
    prisma.report.create({ data: { reporterId: reporter.id, targetUserId, messageId, reason }, select: { id: true } });
  visibleReportId = (await make(offender.id, visibleMsg.id, "visible message report")).id;
  hiddenReportId = (await make(offender.id, hiddenMsg.id, "hidden channel report")).id;
  selfReportId = (await make(mod.id, modMsg.id, "report against the moderator")).id;
  userLevelReportId = (await make(offender.id, null, "user-level report filed elsewhere")).id;
  foreignReportId = (await make(offender.id, foreignMsg.id, "report in another server")).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/servers/:serverId/reports", () => {
  it("rejects anonymous callers and members without a moderation permission", async () => {
    authMock.getSession.mockResolvedValueOnce(null);
    expect((await list()).status).toBe(401);
    signIn(member);
    expect((await list()).status).toBe(403);
  });

  it("shows a moderator only message reports they can see in this server, never their own", async () => {
    signIn(mod);
    const res = await list();
    expect(res.status).toBe(200);
    const data = await res.json();
    const ids = data.reports.map((r: { id: string }) => r.id);
    expect(ids).toEqual([visibleReportId]);
    expect(ids).not.toContain(hiddenReportId); // channel hidden from mods
    expect(ids).not.toContain(selfReportId); // conflict of interest
    expect(ids).not.toContain(userLevelReportId); // no provable server context
    expect(ids).not.toContain(foreignReportId); // another server's message
    expect(data.openCount).toBe(1);

    const [report] = data.reports;
    expect(report.reporter).toEqual({ id: reporter.id, username: reporter.username });
    expect(report.target).toEqual({ id: offender.id, username: offender.username });
    expect(report.message.snippet).toBe("visible abuse line");
    expect(report.message.channelName).toBe("general");
    expect(JSON.stringify(data)).not.toContain("@t.local");
  });

  it("lets the owner see hidden-channel and mod-targeted reports, still not user-level ones", async () => {
    signIn(owner);
    const data = await (await list()).json();
    const ids = data.reports.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining([visibleReportId, hiddenReportId, selfReportId]));
    expect(ids).not.toContain(userLevelReportId);
    expect(ids).not.toContain(foreignReportId);
  });

  it("routes user-level reports to the instance operator view", async () => {
    const unscoped = await listUnscopedOpenReports();
    expect(unscoped.map((r) => r.id)).toContain(userLevelReportId);
    expect(unscoped.map((r) => r.id)).not.toContain(visibleReportId);
  });
});

describe("PATCH /api/servers/:serverId/reports/:reportId", () => {
  it("404s reports the moderator can't review here", async () => {
    signIn(mod);
    expect((await patch(selfReportId, "dismissed")).status).toBe(404);
    expect((await patch(hiddenReportId, "resolved")).status).toBe(404);
    expect((await patch(userLevelReportId, "resolved")).status).toBe(404);
    expect((await patch(foreignReportId, "resolved")).status).toBe(404);
    const untouched = await prisma.report.findMany({
      where: { id: { in: [selfReportId, hiddenReportId, userLevelReportId, foreignReportId] } },
      select: { status: true },
    });
    expect(untouched.every((r) => r.status === "open")).toBe(true);
  });

  it("validates the status and permission", async () => {
    signIn(mod);
    expect((await patch(visibleReportId, "open")).status).toBe(400);
    signIn(member);
    expect((await patch(visibleReportId, "resolved")).status).toBe(403);
  });

  it("resolves once, writes an audit row, then 409s", async () => {
    signIn(mod);
    const res = await patch(visibleReportId, "resolved");
    expect(res.status).toBe(200);
    expect((await prisma.report.findUnique({ where: { id: visibleReportId } }))?.status).toBe("resolved");
    const audit = await prisma.auditLog.findMany({ where: { serverId, action: "report_resolve" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: mod.id, targetId: offender.id });

    expect((await patch(visibleReportId, "dismissed")).status).toBe(409);
    expect(await prisma.auditLog.count({ where: { serverId, action: { startsWith: "report_" } } })).toBe(1);

    const after = await (await list()).json();
    expect(after.reports).toHaveLength(0);
  });
});
