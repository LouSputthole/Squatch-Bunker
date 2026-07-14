import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { POST } from "@/app/api/messages/route";

let attackerId: string;
let attackerChannelId: string;
let victimMessageId: string;

function postMessage(body: Record<string, unknown>) {
  return POST(
    new Request("http://test.local/api/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeAll(async () => {
  const attacker = await prisma.user.create({
    data: { email: "ref-attacker@t.local", username: "ref_attacker", passwordHash: "x" },
  });
  const victim = await prisma.user.create({
    data: { email: "ref-victim@t.local", username: "ref_victim", passwordHash: "x" },
  });
  attackerId = attacker.id;
  authMock.getSession.mockResolvedValue({ userId: attacker.id, username: attacker.username });

  const attackerServer = await prisma.server.create({
    data: {
      name: "Attacker server",
      ownerId: attacker.id,
      members: { create: { userId: attacker.id, role: "owner" } },
      channels: { create: { name: "attacker-channel", type: "text" } },
    },
    include: { channels: true },
  });
  attackerChannelId = attackerServer.channels[0].id;

  const victimServer = await prisma.server.create({
    data: {
      name: "Private victim server",
      ownerId: victim.id,
      members: { create: { userId: victim.id, role: "owner" } },
      channels: { create: { name: "private-channel", type: "text" } },
    },
    include: { channels: true },
  });
  const victimMessage = await prisma.message.create({
    data: {
      channelId: victimServer.channels[0].id,
      authorId: victim.id,
      content: "private cross-server content",
    },
  });
  victimMessageId = victimMessage.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/messages reference boundaries", () => {
  it("rejects a reply target from another channel instead of returning its content", async () => {
    const response = await postMessage({
      channelId: attackerChannelId,
      content: "cross-server reply",
      replyToId: victimMessageId,
    });

    expect(response.status).toBe(400);
    expect(await prisma.message.count({
      where: { channelId: attackerChannelId, authorId: attackerId, replyToId: victimMessageId },
    })).toBe(0);
  });

  it("rejects a thread parent from another channel", async () => {
    const response = await postMessage({
      channelId: attackerChannelId,
      content: "cross-server thread",
      parentMessageId: victimMessageId,
    });

    expect(response.status).toBe(400);
    expect(await prisma.message.count({
      where: { channelId: attackerChannelId, authorId: attackerId, parentMessageId: victimMessageId },
    })).toBe(0);
  });

  it("still accepts reply and thread references from the destination channel", async () => {
    const anchor = await prisma.message.create({
      data: {
        channelId: attackerChannelId,
        authorId: attackerId,
        content: "same-channel anchor",
      },
    });

    const response = await postMessage({
      channelId: attackerChannelId,
      content: "valid local reference",
      replyToId: anchor.id,
      parentMessageId: anchor.id,
    });

    expect(response.status).toBe(201);
    expect((await response.json()).message).toMatchObject({
      replyToId: anchor.id,
      parentMessageId: anchor.id,
    });
  });
});
