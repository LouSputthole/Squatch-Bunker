import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { deliverDueMessages } from "@/lib/scheduledDelivery";
import { POST as processScheduledMessages } from "@/app/api/scheduled-messages/process/route";

let authorId: string;
let channelId: string;

beforeAll(async () => {
  const suffix = Math.random().toString(36).slice(2);
  const author = await prisma.user.create({
    data: {
      email: `schedule-${suffix}@test.local`,
      username: `schedule_${suffix}`,
      passwordHash: "x",
    },
  });
  const server = await prisma.server.create({
    data: { name: `Schedule ${suffix}`, ownerId: author.id },
  });
  await prisma.serverMember.create({
    data: { serverId: server.id, userId: author.id, role: "owner" },
  });
  const channel = await prisma.channel.create({
    data: { serverId: server.id, name: "later", type: "text" },
  });
  authorId = author.id;
  channelId = channel.id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("deliverDueMessages", () => {
  it("atomically delivers a due message exactly once", async () => {
    const scheduled = await prisma.scheduledMessage.create({
      data: {
        channelId,
        authorId,
        content: "The fire starts now",
        sendAt: new Date(Date.now() - 1_000),
      },
    });

    const first = await deliverDueMessages();
    const second = await deliverDueMessages();

    expect(first.delivered).toHaveLength(1);
    expect(second.delivered).toHaveLength(0);
    expect(first.delivered[0]).toMatchObject({
      channelId,
      authorId,
      content: "The fire starts now",
    });
    expect(
      await prisma.message.count({
        where: { channelId, content: "The fire starts now" },
      }),
    ).toBe(1);
    expect(
      await prisma.scheduledMessage.findUnique({ where: { id: scheduled.id } }),
    ).toMatchObject({ sent: true });
  });

  it("leaves future messages pending", async () => {
    const scheduled = await prisma.scheduledMessage.create({
      data: {
        channelId,
        authorId,
        content: "Not yet",
        sendAt: new Date(Date.now() + 60_000),
      },
    });

    const result = await deliverDueMessages();
    expect(result.delivered).toHaveLength(0);
    expect(
      await prisma.scheduledMessage.findUnique({ where: { id: scheduled.id } }),
    ).toMatchObject({ sent: false });
  });

  it("drops a due message when channel send access was revoked", async () => {
    const scheduled = await prisma.scheduledMessage.create({
      data: {
        channelId,
        authorId,
        content: "This should no longer be delivered",
        sendAt: new Date(Date.now() - 1_000),
      },
    });
    await prisma.channelPermission.create({
      data: {
        channelId,
        role: "owner",
        canView: true,
        canSend: false,
      },
    });

    try {
      const result = await deliverDueMessages();
      expect(result.dropped).toContain(scheduled.id);
      expect(
        await prisma.message.count({
          where: {
            channelId,
            authorId,
            content: "This should no longer be delivered",
          },
        }),
      ).toBe(0);
      expect(
        await prisma.scheduledMessage.findUnique({ where: { id: scheduled.id } }),
      ).toBeNull();
    } finally {
      await prisma.channelPermission.deleteMany({
        where: { channelId, role: "owner" },
      });
    }
  });

  it("drops a due message when the sender membership was revoked", async () => {
    const scheduled = await prisma.scheduledMessage.create({
      data: {
        channelId,
        authorId,
        content: "A banned sender must not publish later",
        sendAt: new Date(Date.now() - 1_000),
      },
    });
    await prisma.serverMember.updateMany({
      where: { userId: authorId, server: { channels: { some: { id: channelId } } } },
      data: { banned: true },
    });

    try {
      const result = await deliverDueMessages();
      expect(result.dropped).toContain(scheduled.id);
      expect(
        await prisma.message.count({
          where: {
            channelId,
            authorId,
            content: "A banned sender must not publish later",
          },
        }),
      ).toBe(0);
    } finally {
      await prisma.serverMember.updateMany({
        where: { userId: authorId, server: { channels: { some: { id: channelId } } } },
        data: { banned: false },
      });
    }
  });
});

describe("POST /api/scheduled-messages/process", () => {
  it("stays closed when no external scheduler secret is configured", async () => {
    vi.stubEnv("SCHEDULER_SECRET", "");
    const response = await processScheduledMessages(
      new Request("http://test.local/api/scheduled-messages/process", { method: "POST" }),
    );
    expect(response.status).toBe(503);
  });

  it("requires the configured bearer secret", async () => {
    vi.stubEnv("SCHEDULER_SECRET", "scheduler-test-secret");
    const response = await processScheduledMessages(
      new Request("http://test.local/api/scheduled-messages/process", { method: "POST" }),
    );
    expect(response.status).toBe(401);
  });
});
