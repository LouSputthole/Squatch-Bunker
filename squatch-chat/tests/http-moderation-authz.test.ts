import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { PATCH as reorderChannels } from "@/app/api/channels/reorder/route";
import {
  GET as getChannelPermissions,
  PUT as putChannelPermissions,
} from "@/app/api/channels/[channelId]/permissions/route";
import { POST as purgeMessages } from "@/app/api/messages/purge/route";
import { POST as reactToMessage } from "@/app/api/messages/[messageId]/reactions/route";
import { PATCH as editMessage } from "@/app/api/messages/[messageId]/route";
import {
  DELETE as deleteEmoji,
  GET as getEmoji,
  POST as createEmoji,
} from "@/app/api/servers/[serverId]/emoji/route";
import * as auditLogRoute from "@/app/api/servers/[serverId]/audit-log/route";
import {
  GET as getWelcome,
  PATCH as patchWelcome,
} from "@/app/api/servers/[serverId]/welcome/route";
import { PATCH as patchServer } from "@/app/api/servers/[serverId]/route";

interface TestUser {
  id: string;
  username: string;
}

let owner: TestUser;
let manager: TestUser;
let ordinary: TestUser;
let readOnly: TestUser;
let bannedAdmin: TestUser;
let outsider: TestUser;
let serverId: string;
let managedChannelId: string;
let secondChannelId: string;
let readOnlyChannelId: string;
let hiddenChannelId: string;
let purgeMessageId: string;
let bannedPurgeMessageId: string;
let readOnlyMessageId: string;
let hiddenPurgeMessageId: string;
let existingEmojiId: string;

function signIn(user: TestUser) {
  authMock.getSession.mockResolvedValue({
    userId: user.id,
    username: user.username,
  });
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function serverParams() {
  return { params: Promise.resolve({ serverId }) };
}

function channelParams(channelId: string) {
  return { params: Promise.resolve({ channelId }) };
}

function messageParams(messageId: string) {
  return { params: Promise.resolve({ messageId }) };
}

beforeAll(async () => {
  [owner, manager, ordinary, readOnly, bannedAdmin, outsider] = await Promise.all(
    [
      "owner",
      "manager",
      "ordinary",
      "readonly",
      "banned",
      "outsider",
    ].map((name) =>
      prisma.user.create({
        data: {
          email: "http-auth-" + name + "@t.local",
          username: "http_auth_" + name,
          passwordHash: "x",
        },
      }),
    ),
  );

  const server = await prisma.server.create({
    data: {
      name: "HTTP moderation authorization",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: manager.id, role: "member" },
          { userId: ordinary.id, role: "member" },
          { userId: readOnly.id, role: "member" },
          {
            userId: bannedAdmin.id,
            role: "admin",
            banned: true,
            bannedAt: new Date(),
          },
        ],
      },
    },
  });
  serverId = server.id;

  const managerMembership = await prisma.serverMember.findUniqueOrThrow({
    where: {
      serverId_userId: { serverId, userId: manager.id },
    },
  });
  const managerRole = await prisma.role.create({
    data: {
      serverId,
      name: "Trail steward",
      position: 60,
      permissions: JSON.stringify([
        "MANAGE_CHANNELS",
        "MANAGE_MESSAGES",
        "MANAGE_ROLES",
        "MANAGE_EMOJIS",
        "VIEW_AUDIT_LOG",
        "MANAGE_SERVER",
        "BAN_MEMBERS",
        "KICK_MEMBERS",
      ]),
    },
  });
  await prisma.serverMemberRole.create({
    data: { memberId: managerMembership.id, roleId: managerRole.id },
  });

  const channels = await Promise.all([
    prisma.channel.create({
      data: { serverId, name: "managed", type: "text", position: 0 },
    }),
    prisma.channel.create({
      data: { serverId, name: "second", type: "text", position: 1 },
    }),
    prisma.channel.create({
      data: { serverId, name: "read-only", type: "text", position: 2 },
    }),
    prisma.channel.create({
      data: { serverId, name: "hidden-moderation", type: "text", position: 3 },
    }),
  ]);
  [managedChannelId, secondChannelId, readOnlyChannelId, hiddenChannelId] = channels.map(
    (channel) => channel.id,
  );

  await prisma.channelPermission.createMany({
    data: [
      {
        channelId: readOnlyChannelId,
        role: "member",
        canView: true,
        canSend: false,
      },
      {
        channelId: hiddenChannelId,
        role: "member",
        canView: false,
        canSend: false,
      },
    ],
  });

  const messages = await Promise.all([
    prisma.message.create({
      data: {
        channelId: managedChannelId,
        authorId: ordinary.id,
        content: "purge by custom moderator",
      },
    }),
    prisma.message.create({
      data: {
        channelId: managedChannelId,
        authorId: manager.id,
        content: "banned admin must not purge",
      },
    }),
    prisma.message.create({
      data: {
        channelId: readOnlyChannelId,
        authorId: readOnly.id,
        content: "locked after channel became read only",
      },
    }),
    prisma.message.create({
      data: {
        channelId: hiddenChannelId,
        authorId: ordinary.id,
        content: "hidden purge target",
        attachmentUrl: "/uploads/hidden-purge-target.txt",
      },
    }),
  ]);
  [purgeMessageId, bannedPurgeMessageId, readOnlyMessageId, hiddenPurgeMessageId] =
    messages.map((message) => message.id);

  existingEmojiId = (
    await prisma.customEmoji.create({
      data: {
        serverId,
        name: "existing",
        url: "https://example.test/existing.png",
        createdBy: owner.id,
      },
    })
  ).id;

  await prisma.auditLog.create({
    data: {
      serverId,
      actorId: owner.id,
      action: "server_created",
      detail: "fixture",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("effective channel and message permissions", () => {
  it("lets a custom MANAGE_CHANNELS role reorder channels", async () => {
    signIn(manager);
    const response = await reorderChannels(
      jsonRequest("http://test.local/api/channels/reorder", "PATCH", {
        serverId,
        channelIds: [secondChannelId, managedChannelId, readOnlyChannelId],
      }),
    );

    expect(response.status).toBe(200);
    await expect(
      prisma.channel.findUniqueOrThrow({ where: { id: secondChannelId } }),
    ).resolves.toMatchObject({ position: 0 });
  });

  it("lets a custom MANAGE_CHANNELS role read and update overrides", async () => {
    signIn(manager);
    expect(
      (
        await getChannelPermissions(
          new NextRequest("http://test.local/api/channels/permissions"),
          channelParams(managedChannelId),
        )
      ).status,
    ).toBe(200);

    const response = await putChannelPermissions(
      jsonRequest(
        "http://test.local/api/channels/" + managedChannelId + "/permissions",
        "PUT",
        { role: "mod", canView: true, canSend: false },
      ),
      channelParams(managedChannelId),
    );
    expect(response.status).toBe(200);
  });

  it("does not let a banned legacy admin reorder channels", async () => {
    signIn(bannedAdmin);
    const response = await reorderChannels(
      jsonRequest("http://test.local/api/channels/reorder", "PATCH", {
        serverId,
        channelIds: [managedChannelId, secondChannelId],
      }),
    );
    expect(response.status).toBe(403);
  });

  it("lets a custom MANAGE_MESSAGES role purge messages", async () => {
    signIn(manager);
    const response = await purgeMessages(
      jsonRequest("http://test.local/api/messages/purge", "POST", {
        channelId: managedChannelId,
        count: 1,
        userId: ordinary.id,
      }),
    );
    expect(response.status).toBe(200);
    await expect(
      prisma.message.findUnique({ where: { id: purgeMessageId } }),
    ).resolves.toBeNull();
  });

  it("does not let a banned legacy admin purge messages", async () => {
    signIn(bannedAdmin);
    const response = await purgeMessages(
      jsonRequest("http://test.local/api/messages/purge", "POST", {
        channelId: managedChannelId,
        count: 1,
        userId: manager.id,
      }),
    );
    expect(response.status).toBe(403);
    await expect(
      prisma.message.findUnique({ where: { id: bannedPurgeMessageId } }),
    ).resolves.not.toBeNull();
  });

  it("does not let a custom moderator purge a channel hidden from their legacy role", async () => {
    signIn(manager);
    const auditsBefore = await prisma.auditLog.count({
      where: {
        serverId,
        actorId: manager.id,
        action: "message_purge",
        detail: { contains: hiddenChannelId },
      },
    });

    const response = await purgeMessages(
      jsonRequest("http://test.local/api/messages/purge", "POST", {
        channelId: hiddenChannelId,
        count: 1,
        userId: ordinary.id,
      }),
    );

    expect(response.status).toBe(403);
    await expect(
      prisma.message.findUnique({
        where: { id: hiddenPurgeMessageId },
        select: { attachmentUrl: true },
      }),
    ).resolves.toEqual({ attachmentUrl: "/uploads/hidden-purge-target.txt" });
    await expect(
      prisma.auditLog.count({
        where: {
          serverId,
          actorId: manager.id,
          action: "message_purge",
          detail: { contains: hiddenChannelId },
        },
      }),
    ).resolves.toBe(auditsBefore);
  });

  it("does not let a read-only member mutate reactions", async () => {
    signIn(readOnly);
    const response = await reactToMessage(
      jsonRequest(
        "http://test.local/api/messages/" + readOnlyMessageId + "/reactions",
        "POST",
        { emoji: "fire" },
      ),
      messageParams(readOnlyMessageId),
    );
    const count = await prisma.reaction.count({
      where: { messageId: readOnlyMessageId, userId: readOnly.id },
    });
    await prisma.reaction.deleteMany({
      where: { messageId: readOnlyMessageId, userId: readOnly.id },
    });

    expect(response.status).toBe(403);
    expect(count).toBe(0);
  });

  it("does not let an author edit after the channel becomes read-only", async () => {
    signIn(readOnly);
    const response = await editMessage(
      jsonRequest(
        "http://test.local/api/messages/" + readOnlyMessageId,
        "PATCH",
        { content: "forged read-only edit" },
      ),
      messageParams(readOnlyMessageId),
    );
    const stored = await prisma.message.findUniqueOrThrow({
      where: { id: readOnlyMessageId },
    });
    await prisma.message.update({
      where: { id: readOnlyMessageId },
      data: { content: "locked after channel became read only", editedAt: null },
    });

    expect(response.status).toBe(403);
    expect(stored.content).toBe("locked after channel became read only");
  });
});

describe("server-scoped effective permissions", () => {
  it("requires active membership to list custom emoji", async () => {
    signIn(outsider);
    expect(
      (
        await getEmoji(
          new NextRequest("http://test.local/api/servers/" + serverId + "/emoji"),
          serverParams(),
        )
      ).status,
    ).toBe(403);

    signIn(bannedAdmin);
    expect(
      (
        await getEmoji(
          new NextRequest("http://test.local/api/servers/" + serverId + "/emoji"),
          serverParams(),
        )
      ).status,
    ).toBe(403);
  });

  it("lets a custom MANAGE_EMOJIS role create and delete emoji", async () => {
    signIn(manager);
    const createResponse = await createEmoji(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/emoji",
        "POST",
        { name: "trailfire", url: "https://example.test/trailfire.png" },
      ),
      serverParams(),
    );
    expect(createResponse.status).toBe(201);

    const deleteResponse = await deleteEmoji(
      new NextRequest(
        "http://test.local/api/servers/" + serverId + "/emoji?id=" + existingEmojiId,
        { method: "DELETE" },
      ),
      serverParams(),
    );
    expect(deleteResponse.status).toBe(200);
  });

  it("lets a custom VIEW_AUDIT_LOG role read logs", async () => {
    signIn(manager);
    const response = await auditLogRoute.GET(
      new NextRequest(
        "http://test.local/api/servers/" + serverId + "/audit-log",
      ),
      serverParams(),
    );
    expect(response.status).toBe(200);
  });

  it("does not let a banned legacy admin read logs", async () => {
    signIn(bannedAdmin);
    const response = await auditLogRoute.GET(
      new NextRequest(
        "http://test.local/api/servers/" + serverId + "/audit-log",
      ),
      serverParams(),
    );
    expect(response.status).toBe(403);
  });

  it("does not export a client-callable audit-log mutation", () => {
    expect("POST" in auditLogRoute).toBe(false);
  });

  it("requires active membership to read welcome settings", async () => {
    signIn(bannedAdmin);
    const response = await getWelcome(
      new NextRequest(
        "http://test.local/api/servers/" + serverId + "/welcome",
      ),
      serverParams(),
    );
    expect(response.status).toBe(403);
  });

  it("omits highlighted channels hidden from the current member", async () => {
    signIn(ordinary);
    const hiddenChannel = await prisma.channel.create({
      data: { serverId, name: "hidden-welcome", type: "text", position: 3 },
    });
    await prisma.channelPermission.create({
      data: {
        channelId: hiddenChannel.id,
        role: "member",
        canView: false,
        canSend: false,
      },
    });
    await prisma.server.update({
      where: { id: serverId },
      data: {
        welcomeChannelIds: JSON.stringify([managedChannelId, hiddenChannel.id]),
      },
    });

    const response = await getWelcome(
      new NextRequest(
        "http://test.local/api/servers/" + serverId + "/welcome",
      ),
      serverParams(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      welcome: { welcomeChannelIds: JSON.stringify([managedChannelId]) },
    });
  });

  it("rejects highlighted channels owned by another server", async () => {
    signIn(manager);
    const foreignServer = await prisma.server.create({
      data: { name: "Foreign welcome channel", ownerId: outsider.id },
    });
    const foreignChannel = await prisma.channel.create({
      data: { serverId: foreignServer.id, name: "foreign", type: "text" },
    });

    const response = await patchWelcome(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/welcome",
        "PATCH",
        { welcomeChannelIds: [foreignChannel.id] },
      ),
      serverParams(),
    );

    expect(response.status).toBe(400);
  });

  it("lets a custom MANAGE_SERVER role update welcome and server settings", async () => {
    signIn(manager);
    const welcomeResponse = await patchWelcome(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/welcome",
        "PATCH",
        { welcomeMessage: "Gather around the new fire" },
      ),
      serverParams(),
    );
    expect(welcomeResponse.status).toBe(200);

    const serverResponse = await patchServer(
      jsonRequest(
        "http://test.local/api/servers/" + serverId,
        "PATCH",
        { name: "Managed by effective permission" },
      ),
      serverParams(),
    );
    expect(serverResponse.status).toBe(200);
  });
});
