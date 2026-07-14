import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET as getServers } from "@/app/api/servers/route";
import { POST as joinServer } from "@/app/api/servers/join/route";
import { GET as searchMessages } from "@/app/api/messages/search/route";
import { GET as getBookmarks, POST as createBookmark } from "@/app/api/bookmarks/route";

let ownerId: string;
let memberId: string;
let adminId: string;
let bannedUserId: string;
let serverId: string;
let inviteCode: string;
let visibleChannelId: string;
let hiddenChannelId: string;
let visibleMessageId: string;
let hiddenBookmarkMessageId: string;
let hiddenPostMessageId: string;
let bannedServerId: string;

beforeAll(async () => {
  const [owner, member, admin, banned] = await Promise.all([
    prisma.user.create({
      data: {
        email: "hidden-http-owner@t.local",
        username: "hidden_http_owner",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "hidden-http-member@t.local",
        username: "hidden_http_member",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "hidden-http-admin@t.local",
        username: "hidden_http_admin",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "hidden-http-banned@t.local",
        username: "hidden_http_banned",
        passwordHash: "x",
      },
    }),
  ]);
  ownerId = owner.id;
  memberId = member.id;
  adminId = admin.id;
  bannedUserId = banned.id;

  const server = await prisma.server.create({
    data: {
      name: "Hidden HTTP tests",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: member.id, role: "member" },
          { userId: admin.id, role: "admin" },
        ],
      },
    },
  });
  serverId = server.id;
  inviteCode = server.inviteCode;

  const [visible, hidden] = await Promise.all([
    prisma.channel.create({
      data: { serverId: server.id, name: "visible-http", type: "text" },
    }),
    prisma.channel.create({
      data: { serverId: server.id, name: "hidden-http", type: "text" },
    }),
  ]);
  visibleChannelId = visible.id;
  hiddenChannelId = hidden.id;

  await prisma.channelPermission.create({
    data: {
      channelId: hidden.id,
      role: "member",
      canView: false,
      canSend: false,
    },
  });

  authMock.getSession.mockResolvedValue({
    userId: member.id,
    username: member.username,
  });
});

beforeAll(async () => {
  const [visibleMessage, hiddenBookmarkMessage, hiddenPostMessage] =
    await Promise.all([
      prisma.message.create({
        data: {
          channelId: visibleChannelId,
          authorId: ownerId,
          content: "http-visibility-needle public ember",
        },
      }),
      prisma.message.create({
        data: {
          channelId: hiddenChannelId,
          authorId: ownerId,
          content: "http-visibility-needle secret bookmark ember",
        },
      }),
      prisma.message.create({
        data: {
          channelId: hiddenChannelId,
          authorId: ownerId,
          content: "hidden post-only bookmark target",
        },
      }),
    ]);
  visibleMessageId = visibleMessage.id;
  hiddenBookmarkMessageId = hiddenBookmarkMessage.id;
  hiddenPostMessageId = hiddenPostMessage.id;

  await prisma.bookmark.createMany({
    data: [
      { userId: memberId, messageId: visibleMessageId },
      { userId: memberId, messageId: hiddenBookmarkMessageId },
    ],
  });

  const bannedServer = await prisma.server.create({
    data: {
      name: "Banned HTTP tests",
      ownerId,
      members: {
        create: [
          { userId: ownerId, role: "owner" },
          { userId: bannedUserId, role: "member", banned: true },
        ],
      },
      channels: { create: { name: "banned-http", type: "text" } },
    },
  });
  bannedServerId = bannedServer.id;
});

describe("GET /api/servers channel visibility", () => {
  it("omits channels hidden from the active member", async () => {
    const response = await getServers();
    expect(response.status).toBe(200);

    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).toContain(visibleChannelId);
    expect(serialized).not.toContain(hiddenChannelId);
    expect(serialized).not.toContain("hidden-http");
  });

  it("preserves hidden-channel visibility for owner and admin roles", async () => {
    for (const identity of [
      { userId: ownerId, username: "hidden_http_owner" },
      { userId: adminId, username: "hidden_http_admin" },
    ]) {
      authMock.getSession.mockResolvedValueOnce(identity);
      const response = await getServers();
      expect(response.status).toBe(200);
      const serialized = JSON.stringify(await response.json());
      expect(serialized).toContain(hiddenChannelId);
      expect(serialized).toContain("hidden-http");
    }
  });

  it("excludes servers where the only membership is banned", async () => {
    authMock.getSession.mockResolvedValueOnce({
      userId: bannedUserId,
      username: "hidden_http_banned",
    });
    const response = await getServers();
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain(bannedServerId);
    expect(serialized).not.toContain("Banned HTTP tests");
  });

  it("returns an honest 503 when server hydration fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const findMany = vi
      .spyOn(prisma.server, "findMany")
      .mockRejectedValueOnce(new Error("database offline"));
    const response = await getServers();
    findMany.mockRestore();
    consoleError.mockRestore();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Unable to load servers" });
  });
});

describe("POST /api/servers/join channel visibility", () => {
  it("sanitizes the server returned to an existing member", async () => {
    const response = await joinServer(
      new Request("http://test.local/api/servers/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inviteCode }),
      }),
    );
    expect(response.status).toBe(200);

    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain(visibleChannelId);
    expect(serialized).not.toContain(hiddenChannelId);
    expect(serialized).not.toContain("hidden-http");
  });
});

describe("GET /api/messages/search channel visibility", () => {
  function search(query: string) {
    const url =
      "http://test.local/api/messages/search?q=" +
      encodeURIComponent(query) +
      "&serverId=" +
      encodeURIComponent(serverId);
    return searchMessages(new Request(url));
  }

  it("returns matches from visible channels only", async () => {
    const response = await search("http-visibility-needle");
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].id).toBe(visibleMessageId);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(hiddenBookmarkMessageId);
    expect(serialized).not.toContain(hiddenChannelId);
    expect(serialized).not.toContain("secret bookmark ember");
  });

  it("accepts q lengths 1 through 100 and rejects longer values", async () => {
    expect((await search("h")).status).toBe(200);
    expect((await search("x".repeat(100))).status).toBe(200);
    expect((await search("x".repeat(101))).status).toBe(400);
  });
});

describe("GET and POST /api/bookmarks channel visibility", () => {
  it("returns bookmarks from visible channels only", async () => {
    const response = await getBookmarks();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.bookmarks).toHaveLength(1);
    expect(body.bookmarks[0].messageId).toBe(visibleMessageId);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(hiddenBookmarkMessageId);
    expect(serialized).not.toContain("secret bookmark ember");
  });

  it("rejects bookmarking a message in a hidden channel", async () => {
    const response = await createBookmark(
      new NextRequest("http://test.local/api/bookmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: hiddenPostMessageId }),
      }),
    );
    expect(response.status).toBe(403);
    expect(
      await prisma.bookmark.count({
        where: { userId: memberId, messageId: hiddenPostMessageId },
      }),
    ).toBe(0);
  });
});
