import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { resolveChannelAccess } from "@/lib/channelAccess";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET, POST } from "@/app/api/messages/route";
import {
  GET as getScheduledMessages,
  POST as scheduleMessage,
} from "@/app/api/channels/[channelId]/scheduled/route";

let ownerId: string;
let memberId: string;
let bannedMemberId: string;
let hiddenChannelId: string;
let readOnlyChannelId: string;
let openChannelId: string;

function getMessages(channelId: string) {
  return GET(new Request(`http://test.local/api/messages?channelId=${channelId}`));
}

function postMessage(channelId: string, content: string) {
  return POST(
    new Request("http://test.local/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelId, content }),
    }),
  );
}

function schedule(channelId: string) {
  return scheduleMessage(
    new NextRequest(`http://test.local/api/channels/${channelId}/scheduled`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "Later at the fire",
        sendAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    }),
    { params: Promise.resolve({ channelId }) },
  );
}

function listScheduled(channelId: string) {
  return getScheduledMessages(
    new NextRequest(`http://test.local/api/channels/${channelId}/scheduled`),
    { params: Promise.resolve({ channelId }) },
  );
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: "channel-access-owner@t.local",
      username: "channel_access_owner",
      passwordHash: "x",
    },
  });
  const member = await prisma.user.create({
    data: {
      email: "channel-access-member@t.local",
      username: "channel_access_member",
      passwordHash: "x",
    },
  });
  const bannedMember = await prisma.user.create({
    data: {
      email: "channel-access-banned@t.local",
      username: "channel_access_banned",
      passwordHash: "x",
    },
  });
  ownerId = owner.id;
  memberId = member.id;
  bannedMemberId = bannedMember.id;

  const server = await prisma.server.create({
    data: { name: "Channel access tests", ownerId },
  });
  await prisma.serverMember.createMany({
    data: [
      { serverId: server.id, userId: ownerId, role: "owner" },
      { serverId: server.id, userId: memberId, role: "member" },
      {
        serverId: server.id,
        userId: bannedMemberId,
        role: "member",
        banned: true,
      },
    ],
  });

  const [hidden, readOnly, open] = await Promise.all([
    prisma.channel.create({
      data: { serverId: server.id, name: "hidden", type: "text" },
    }),
    prisma.channel.create({
      data: { serverId: server.id, name: "read-only", type: "text" },
    }),
    prisma.channel.create({
      data: { serverId: server.id, name: "open", type: "text" },
    }),
  ]);
  hiddenChannelId = hidden.id;
  readOnlyChannelId = readOnly.id;
  openChannelId = open.id;

  await prisma.channelPermission.createMany({
    data: [
      {
        channelId: hiddenChannelId,
        role: "member",
        canView: false,
        canSend: false,
      },
      {
        channelId: readOnlyChannelId,
        role: "member",
        canView: true,
        canSend: false,
      },
    ],
  });

  await prisma.message.create({
    data: {
      channelId: hiddenChannelId,
      authorId: ownerId,
      content: "members must not read this",
    },
  });

  authMock.getSession.mockResolvedValue({
    userId: memberId,
    username: member.username,
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});


describe("resolveChannelAccess", () => {
  it("resolves hidden, read-only, default-open, and owner access", async () => {
    await expect(resolveChannelAccess(hiddenChannelId, memberId)).resolves.toMatchObject({
      canView: false,
      canSend: false,
    });
    await expect(resolveChannelAccess(readOnlyChannelId, memberId)).resolves.toMatchObject({
      canView: true,
      canSend: false,
    });
    await expect(resolveChannelAccess(openChannelId, memberId)).resolves.toMatchObject({
      canView: true,
      canSend: true,
    });
    await expect(resolveChannelAccess(hiddenChannelId, ownerId)).resolves.toMatchObject({
      canView: true,
      canSend: true,
    });
    await expect(resolveChannelAccess(openChannelId, bannedMemberId)).resolves.toBeNull();
  });
});

describe("message route channel access", () => {
  it("denies hidden-channel reads and writes", async () => {
    expect((await getMessages(hiddenChannelId)).status).toBe(403);
    expect((await postMessage(hiddenChannelId, "not allowed")).status).toBe(403);
  });

  it("allows read-only reads but denies writes", async () => {
    expect((await getMessages(readOnlyChannelId)).status).toBe(200);
    expect((await postMessage(readOnlyChannelId, "not allowed")).status).toBe(403);
  });

  it("keeps channels without an override readable and writable", async () => {
    expect((await getMessages(openChannelId)).status).toBe(200);
    expect((await postMessage(openChannelId, "allowed")).status).toBe(201);
  });
});

describe("scheduled message channel access", () => {
  it("requires effective send permission when creating a schedule", async () => {
    expect((await schedule(hiddenChannelId)).status).toBe(403);
    expect((await schedule(readOnlyChannelId)).status).toBe(403);
    expect((await schedule(openChannelId)).status).toBe(200);
  });

  it("requires effective view permission when listing schedules", async () => {
    expect((await listScheduled(hiddenChannelId)).status).toBe(403);
  });
});
