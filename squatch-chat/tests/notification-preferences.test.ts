import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET, POST } from "@/app/api/notification-preferences/route";

let ownerAId: string;
let ownerBId: string;
let activeId: string;
let bannedId: string;
let outsiderId: string;
let serverAId: string;
let serverBId: string;
let serverCId: string;
let visibleAId: string;
let hiddenAId: string;

function authenticate(userId = activeId, username = "notification_active") {
  authMock.getSession.mockResolvedValue({ userId, username });
}

function postJson(body: unknown) {
  return POST(new Request("http://test.local/api/notification-preferences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function postRaw(body: string) {
  return POST(new Request("http://test.local/api/notification-preferences", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  }));
}

beforeAll(async () => {
  const [ownerA, ownerB, active, banned, outsider] = await Promise.all([
    prisma.user.create({
      data: {
        email: "notification-owner-a@t.local",
        username: "notification_owner_a",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "notification-owner-b@t.local",
        username: "notification_owner_b",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "notification-active@t.local",
        username: "notification_active",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "notification-banned@t.local",
        username: "notification_banned",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "notification-outsider@t.local",
        username: "notification_outsider",
        passwordHash: "x",
      },
    }),
  ]);
  ownerAId = ownerA.id;
  ownerBId = ownerB.id;
  activeId = active.id;
  bannedId = banned.id;
  outsiderId = outsider.id;

  const [serverA, serverB, serverC] = await Promise.all([
    prisma.server.create({
      data: { name: "Notification server A", ownerId: ownerAId },
    }),
    prisma.server.create({
      data: { name: "Notification server B", ownerId: ownerBId },
    }),
    prisma.server.create({
      data: { name: "Notification server C", ownerId: ownerBId },
    }),
  ]);
  serverAId = serverA.id;
  serverBId = serverB.id;
  serverCId = serverC.id;

  await prisma.serverMember.createMany({
    data: [
      { serverId: serverAId, userId: ownerAId, role: "owner" },
      { serverId: serverAId, userId: activeId, role: "member" },
      { serverId: serverAId, userId: bannedId, role: "member", banned: true },
      { serverId: serverBId, userId: ownerBId, role: "owner" },
      { serverId: serverBId, userId: activeId, role: "member" },
      { serverId: serverCId, userId: ownerBId, role: "owner" },
    ],
  });

  const [visibleA, hiddenA] = await Promise.all([
    prisma.channel.create({
      data: { serverId: serverAId, name: "notification-visible", type: "text" },
    }),
    prisma.channel.create({
      data: { serverId: serverAId, name: "notification-hidden", type: "text" },
    }),
  ]);
  visibleAId = visibleA.id;
  hiddenAId = hiddenA.id;

  await prisma.channelPermission.create({
    data: {
      channelId: hiddenAId,
      role: "member",
      canView: false,
      canSend: false,
    },
  });
});

beforeEach(async () => {
  authenticate();
  await prisma.notificationPreference.deleteMany({
    where: { userId: { in: [activeId, bannedId, outsiderId] } },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("notification preference request validation", () => {
  it("requires authentication before reading or parsing a request", async () => {
    authMock.getSession.mockResolvedValue(null);

    expect((await GET()).status).toBe(401);
    expect((await postRaw("{not-json")).status).toBe(401);
  });

  it("rejects malformed JSON, non-objects, invalid levels, and malformed scopes", async () => {
    const responses = await Promise.all([
      postRaw("{not-json"),
      postJson(null),
      postJson([]),
      postJson({}),
      postJson({ level: "everything" }),
      postJson({ level: 3 }),
      postJson({ level: "all", serverId: 3 }),
      postJson({ level: "all", serverId: "" }),
      postJson({ level: "all", serverId: " padded " }),
      postJson({ level: "all", serverId: "x".repeat(129) }),
      postJson({ level: "all", channelId: visibleAId }),
    ]);

    expect(responses.map(({ status }) => status)).toEqual(Array(responses.length).fill(400));
    await expect(
      prisma.notificationPreference.count({ where: { userId: activeId } }),
    ).resolves.toBe(0);
  });

  it("accepts only all, mentions, and none and keeps one global preference", async () => {
    for (const level of ["all", "mentions", "none"]) {
      expect((await postJson({ level })).status).toBe(200);
    }

    await expect(
      prisma.notificationPreference.findMany({
        where: { userId: activeId, serverId: null, channelId: null },
      }),
    ).resolves.toMatchObject([{ level: "none" }]);
  });

  it("collapses pre-existing duplicate null scopes deterministically", async () => {
    // SQLite treats NULL values as distinct inside a composite unique index.
    // The route cleans up sequential duplicates, but a future schema migration
    // is still required to guarantee uniqueness across concurrent writers.
    await prisma.notificationPreference.createMany({
      data: [
        { userId: activeId, serverId: null, channelId: null, level: "all" },
        { userId: activeId, serverId: null, channelId: null, level: "none" },
      ],
    });

    expect((await postJson({ level: "mentions" })).status).toBe(200);
    await expect(
      prisma.notificationPreference.findMany({
        where: { userId: activeId, serverId: null, channelId: null },
      }),
    ).resolves.toMatchObject([{ level: "mentions" }]);
  });
});

describe("notification preference scope authorization", () => {
  it("allows an active member to set server and visible-channel preferences", async () => {
    const serverResponse = await postJson({
      serverId: serverAId,
      level: "mentions",
    });
    const channelResponse = await postJson({
      serverId: serverAId,
      channelId: visibleAId,
      level: "none",
    });

    expect(serverResponse.status).toBe(200);
    expect(channelResponse.status).toBe(200);
    await expect(
      prisma.notificationPreference.count({ where: { userId: activeId } }),
    ).resolves.toBe(2);
  });

  it("does not reveal whether a server is missing, banned, or merely inaccessible", async () => {
    authenticate(outsiderId, "notification_outsider");
    const inaccessible = await postJson({ serverId: serverAId, level: "all" });
    const missing = await postJson({ serverId: "missing-server", level: "all" });

    authenticate(bannedId, "notification_banned");
    const banned = await postJson({ serverId: serverAId, level: "all" });

    expect([inaccessible.status, missing.status, banned.status]).toEqual([403, 403, 403]);
    const bodies = await Promise.all([inaccessible.json(), missing.json(), banned.json()]);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
    await expect(
      prisma.notificationPreference.count({
        where: { userId: { in: [outsiderId, bannedId] } },
      }),
    ).resolves.toBe(0);
  });

  it("does not reveal whether a channel is hidden, missing, inaccessible, or on another server", async () => {
    const hidden = await postJson({
      serverId: serverAId,
      channelId: hiddenAId,
      level: "all",
    });
    const missing = await postJson({
      serverId: serverAId,
      channelId: "missing-channel",
      level: "all",
    });
    const mismatched = await postJson({
      serverId: serverBId,
      channelId: visibleAId,
      level: "all",
    });

    authenticate(outsiderId, "notification_outsider");
    const inaccessible = await postJson({
      serverId: serverAId,
      channelId: visibleAId,
      level: "all",
    });

    expect([
      hidden.status,
      missing.status,
      mismatched.status,
      inaccessible.status,
    ]).toEqual([403, 403, 403, 403]);
    const bodies = await Promise.all([
      hidden.json(),
      missing.json(),
      mismatched.json(),
      inaccessible.json(),
    ]);
    expect(bodies.every((body) => JSON.stringify(body) === JSON.stringify(bodies[0]))).toBe(true);
  });
});

describe("GET /api/notification-preferences visibility", () => {
  it("returns only the caller's global and currently authorized scopes", async () => {
    const created = await Promise.all([
      prisma.notificationPreference.create({
        data: { userId: activeId, serverId: null, channelId: null, level: "all" },
      }),
      prisma.notificationPreference.create({
        data: { userId: activeId, serverId: serverAId, channelId: null, level: "mentions" },
      }),
      prisma.notificationPreference.create({
        data: { userId: activeId, serverId: serverAId, channelId: visibleAId, level: "none" },
      }),
      prisma.notificationPreference.create({
        data: { userId: activeId, serverId: serverAId, channelId: hiddenAId, level: "none" },
      }),
      prisma.notificationPreference.create({
        data: { userId: activeId, serverId: serverBId, channelId: visibleAId, level: "none" },
      }),
      prisma.notificationPreference.create({
        data: { userId: activeId, serverId: serverCId, channelId: null, level: "none" },
      }),
      prisma.notificationPreference.create({
        data: { userId: outsiderId, serverId: null, channelId: null, level: "all" },
      }),
    ]);

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(new Set(body.preferences.map(({ id }: { id: string }) => id))).toEqual(
      new Set(created.slice(0, 3).map(({ id }) => id)),
    );
  });

  it("keeps global settings but hides server and channel settings after a ban", async () => {
    const [globalPreference] = await Promise.all([
      prisma.notificationPreference.create({
        data: { userId: bannedId, serverId: null, channelId: null, level: "all" },
      }),
      prisma.notificationPreference.create({
        data: { userId: bannedId, serverId: serverAId, channelId: null, level: "mentions" },
      }),
      prisma.notificationPreference.create({
        data: { userId: bannedId, serverId: serverAId, channelId: visibleAId, level: "none" },
      }),
    ]);
    authenticate(bannedId, "notification_banned");

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.preferences).toMatchObject([{ id: globalPreference.id }]);
  });
});
