import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { isRetentionDays, sweepExpiredMessages } from "@/lib/messageRetention";

let ownerId: string;
let serverId: string;

beforeAll(async () => {
  const suffix = Math.random().toString(36).slice(2);
  const owner = await prisma.user.create({
    data: {
      email: `retention-${suffix}@test.local`,
      username: `retention_${suffix}`,
      passwordHash: "x",
    },
  });
  const server = await prisma.server.create({
    data: { name: `Retention ${suffix}`, ownerId: owner.id },
  });
  await prisma.serverMember.create({
    data: { serverId: server.id, userId: owner.id, role: "owner" },
  });
  ownerId = owner.id;
  serverId = server.id;
});

describe("message retention", () => {
  it("accepts only supported leave-no-trace windows", () => {
    expect(isRetentionDays(1)).toBe(true);
    expect(isRetentionDays(7)).toBe(true);
    expect(isRetentionDays(30)).toBe(true);
    expect(isRetentionDays(0)).toBe(false);
    expect(isRetentionDays(14)).toBe(false);
    expect(isRetentionDays(null)).toBe(false);
  });

  it("expires old room messages while preserving recent, forever, and Journal snapshots", async () => {
    const now = new Date("2026-07-12T18:00:00.000Z");
    const ephemeral = await prisma.channel.create({
      data: { serverId, name: `trail-${Date.now()}`, type: "text", retentionDays: 1 },
    });
    const forever = await prisma.channel.create({
      data: { serverId, name: `archive-${Date.now()}`, type: "text", retentionDays: null },
    });

    const expired = await prisma.message.create({
      data: {
        channelId: ephemeral.id,
        authorId: ownerId,
        content: "A moment worth keeping",
        createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1_000),
      },
    });
    const recent = await prisma.message.create({
      data: {
        channelId: ephemeral.id,
        authorId: ownerId,
        content: "Still glowing",
        createdAt: new Date(now.getTime() - 2 * 60 * 60 * 1_000),
      },
    });
    const foreverMessage = await prisma.message.create({
      data: {
        channelId: forever.id,
        authorId: ownerId,
        content: "Permanent",
        createdAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1_000),
      },
    });
    const journal = await prisma.journalEntry.create({
      data: {
        serverId,
        authorId: ownerId,
        sourceMessageId: expired.id,
        content: expired.content,
        note: "Saved before the trail faded",
      },
    });

    const result = await sweepExpiredMessages(now);

    expect(result.deletedMessages).toBeGreaterThanOrEqual(1);
    expect(await prisma.message.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.message.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await prisma.message.findUnique({ where: { id: foreverMessage.id } })).not.toBeNull();
    expect(await prisma.journalEntry.findUnique({ where: { id: journal.id } })).toMatchObject({
      content: "A moment worth keeping",
      note: "Saved before the trail faded",
      sourceMessageId: null,
    });
  });
});
