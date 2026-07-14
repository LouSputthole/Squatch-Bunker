import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import {
  DELETE,
  GET,
  PATCH,
} from "@/app/api/messages/[messageId]/route";

let ownerId: string;
let memberId: string;
let moderatorId: string;
let bannedAuthorId: string;
let hiddenByMemberId: string;
let openByMemberId: string;
let openByOwnerForPinId: string;
let openByOwnerForDeleteId: string;
let openByOwnerForDeniedDeleteId: string;
let openByBannedAuthorId: string;

function routeContext(messageId: string) {
  return { params: Promise.resolve({ messageId }) };
}

function getMessage(messageId: string) {
  return GET(
    new Request(`http://test.local/api/messages/${messageId}`),
    routeContext(messageId),
  );
}

function patchMessage(messageId: string, body: unknown) {
  return PATCH(
    new Request(`http://test.local/api/messages/${messageId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    routeContext(messageId),
  );
}

function deleteMessage(messageId: string) {
  return DELETE(
    new Request(`http://test.local/api/messages/${messageId}`, {
      method: "DELETE",
    }),
    routeContext(messageId),
  );
}

function authenticate(userId: string, username: string) {
  authMock.getSession.mockResolvedValue({ userId, username });
}

beforeAll(async () => {
  const [owner, member, moderator, bannedAuthor] = await Promise.all([
    prisma.user.create({
      data: {
        email: "message-detail-owner@t.local",
        username: "message_detail_owner",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "message-detail-member@t.local",
        username: "message_detail_member",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "message-detail-moderator@t.local",
        username: "message_detail_moderator",
        passwordHash: "x",
      },
    }),
    prisma.user.create({
      data: {
        email: "message-detail-banned@t.local",
        username: "message_detail_banned",
        passwordHash: "x",
      },
    }),
  ]);
  ownerId = owner.id;
  memberId = member.id;
  moderatorId = moderator.id;
  bannedAuthorId = bannedAuthor.id;

  const server = await prisma.server.create({
    data: { name: "Message detail authorization", ownerId },
  });
  const memberships = await Promise.all([
    prisma.serverMember.create({
      data: { serverId: server.id, userId: ownerId, role: "owner" },
    }),
    prisma.serverMember.create({
      data: { serverId: server.id, userId: memberId, role: "member" },
    }),
    prisma.serverMember.create({
      data: { serverId: server.id, userId: moderatorId, role: "member" },
    }),
    prisma.serverMember.create({
      data: {
        serverId: server.id,
        userId: bannedAuthorId,
        role: "mod",
        banned: true,
      },
    }),
  ]);

  const moderatorRole = await prisma.role.create({
    data: {
      serverId: server.id,
      name: "Message keeper",
      permissions: JSON.stringify(["MANAGE_MESSAGES"]),
    },
  });
  await prisma.serverMemberRole.create({
    data: { memberId: memberships[2].id, roleId: moderatorRole.id },
  });

  const [openChannel, hiddenChannel] = await Promise.all([
    prisma.channel.create({
      data: { serverId: server.id, name: "open-detail", type: "text" },
    }),
    prisma.channel.create({
      data: { serverId: server.id, name: "hidden-detail", type: "text" },
    }),
  ]);

  await prisma.channelPermission.create({
    data: {
      channelId: hiddenChannel.id,
      role: "member",
      canView: false,
      canSend: false,
    },
  });

  const messages = await Promise.all([
    prisma.message.create({
      data: {
        channelId: hiddenChannel.id,
        authorId: memberId,
        content: "member secret",
      },
    }),
    prisma.message.create({
      data: {
        channelId: openChannel.id,
        authorId: memberId,
        content: "member visible",
      },
    }),
    prisma.message.create({
      data: {
        channelId: openChannel.id,
        authorId: ownerId,
        content: "pin target",
      },
    }),
    prisma.message.create({
      data: {
        channelId: openChannel.id,
        authorId: ownerId,
        content: "moderator delete target",
      },
    }),
    prisma.message.create({
      data: {
        channelId: openChannel.id,
        authorId: ownerId,
        content: "ordinary member delete target",
      },
    }),
    prisma.message.create({
      data: {
        channelId: openChannel.id,
        authorId: bannedAuthorId,
        content: "banned author target",
      },
    }),
  ]);
  [
    hiddenByMemberId,
    openByMemberId,
    openByOwnerForPinId,
    openByOwnerForDeleteId,
    openByOwnerForDeniedDeleteId,
    openByBannedAuthorId,
  ] = messages.map((message) => message.id);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/messages/:messageId authorization", () => {
  it("does not disclose a hidden-channel message to a member", async () => {
    authenticate(memberId, "message_detail_member");
    expect((await getMessage(hiddenByMemberId)).status).toBe(404);
  });

  it("does not disclose an open-channel message to a banned member", async () => {
    authenticate(bannedAuthorId, "message_detail_banned");
    expect((await getMessage(openByMemberId)).status).toBe(404);
  });
});

describe("PATCH /api/messages/:messageId authorization", () => {
  it("does not let an author edit a message after losing channel visibility", async () => {
    authenticate(memberId, "message_detail_member");
    const response = await patchMessage(hiddenByMemberId, { content: "leaked edit" });
    expect(response.status).toBe(404);
    await expect(
      prisma.message.findUniqueOrThrow({ where: { id: hiddenByMemberId } }),
    ).resolves.toMatchObject({ content: "member secret" });
  });

  it("does not let a banned author edit their old message", async () => {
    authenticate(bannedAuthorId, "message_detail_banned");
    expect(
      (await patchMessage(openByBannedAuthorId, { content: "banned edit" })).status,
    ).toBe(404);
  });

  it("allows a custom role with MANAGE_MESSAGES to pin", async () => {
    authenticate(moderatorId, "message_detail_moderator");
    const response = await patchMessage(openByOwnerForPinId, { pinned: true });
    expect(response.status).toBe(200);
    await expect(
      prisma.message.findUniqueOrThrow({ where: { id: openByOwnerForPinId } }),
    ).resolves.toMatchObject({ pinned: true });
  });

  it("rejects ordinary members and invalid pin values", async () => {
    authenticate(memberId, "message_detail_member");
    expect(
      (await patchMessage(openByOwnerForPinId, { pinned: false })).status,
    ).toBe(403);
    expect(
      (await patchMessage(openByMemberId, { pinned: "yes" })).status,
    ).toBe(400);
  });

  it("still lets an active author edit their visible message", async () => {
    authenticate(memberId, "message_detail_member");
    const response = await patchMessage(openByMemberId, { content: "edited safely" });
    expect(response.status).toBe(200);
  });
});

describe("DELETE /api/messages/:messageId authorization", () => {
  it("allows a custom role with MANAGE_MESSAGES to delete another user's message", async () => {
    authenticate(moderatorId, "message_detail_moderator");
    expect((await deleteMessage(openByOwnerForDeleteId)).status).toBe(200);
    await expect(
      prisma.message.findUnique({ where: { id: openByOwnerForDeleteId } }),
    ).resolves.toBeNull();
  });

  it("rejects an ordinary member deleting another user's message", async () => {
    authenticate(memberId, "message_detail_member");
    expect((await deleteMessage(openByOwnerForDeniedDeleteId)).status).toBe(403);
  });

  it("does not let a banned author delete their old message", async () => {
    authenticate(bannedAuthorId, "message_detail_banned");
    expect((await deleteMessage(openByBannedAuthorId)).status).toBe(404);
    await expect(
      prisma.message.findUnique({ where: { id: openByBannedAuthorId } }),
    ).resolves.not.toBeNull();
  });
});
