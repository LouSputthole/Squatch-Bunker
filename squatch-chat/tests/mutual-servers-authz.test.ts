import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET } from "@/app/api/users/[userId]/mutual-servers/route";

let viewerId: string;
let targetId: string;
let visibleServerId: string;
let viewerBannedServerId: string;
let targetBannedServerId: string;

beforeAll(async () => {
  const [viewer, target] = await Promise.all([
    prisma.user.create({
      data: {
        email: "mutual-viewer@t.local",
        username: "mutual_viewer",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "mutual-target@t.local",
        username: "mutual_target",
        passwordHash: "x",
      },
    }),
  ]);
  viewerId = viewer.id;
  targetId = target.id;

  const servers = await Promise.all([
    prisma.server.create({ data: { name: "Visible mutual", ownerId: viewer.id } }),
    prisma.server.create({ data: { name: "Viewer banned mutual", ownerId: target.id } }),
    prisma.server.create({ data: { name: "Target banned mutual", ownerId: viewer.id } }),
  ]);
  [visibleServerId, viewerBannedServerId, targetBannedServerId] = servers.map(
    (server) => server.id,
  );

  await prisma.serverMember.createMany({
    data: [
      { serverId: visibleServerId, userId: viewerId, role: "owner" },
      { serverId: visibleServerId, userId: targetId, role: "member" },
      {
        serverId: viewerBannedServerId,
        userId: viewerId,
        role: "member",
        banned: true,
      },
      { serverId: viewerBannedServerId, userId: targetId, role: "owner" },
      { serverId: targetBannedServerId, userId: viewerId, role: "owner" },
      {
        serverId: targetBannedServerId,
        userId: targetId,
        role: "member",
        banned: true,
      },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/users/:userId/mutual-servers authorization", () => {
  it("only returns servers where both users are active members", async () => {
    authMock.getSession.mockResolvedValue({
      userId: viewerId,
      username: "mutual_viewer",
    });

    const response = await GET(
      new NextRequest(`http://test.local/api/users/${targetId}/mutual-servers`),
      { params: Promise.resolve({ userId: targetId }) },
    );
    const body = (await response.json()) as {
      servers: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.servers.map((server) => server.id)).toEqual([visibleServerId]);
    expect(JSON.stringify(body)).not.toContain(viewerBannedServerId);
    expect(JSON.stringify(body)).not.toContain(targetBannedServerId);
  });
});
