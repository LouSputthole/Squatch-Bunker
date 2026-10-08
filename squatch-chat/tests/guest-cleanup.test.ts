import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { sweepExpiredGuests } from "@/lib/guestCleanup";

// Hourly expired-guest sweep: delete guests who left no trace, retire the rest.

const tag = Math.random().toString(36).slice(2, 8);
const NOW = new Date("2031-06-01T12:00:00.000Z");
const EXPIRED = new Date(NOW.getTime() - 60_000);
const ACTIVE = new Date(NOW.getTime() + 60 * 60_000);

function guest(name: string, guestExpiresAt: Date) {
  return prisma.user.create({
    data: {
      email: `guest-${name}-${tag}@campfire.local`,
      username: `${name}#${tag}`,
      passwordHash: "x",
      isGuest: true,
      guestExpiresAt,
    },
    select: { id: true, tokenVersion: true },
  });
}

let regular: { id: string };
let lurker: { id: string };
let talker: { id: string; tokenVersion: number };
let fresh: { id: string };
let serverId: string;
let talkerServerId: string;
let joinNoticeId: string;
let replyId: string;
let talkerMessageId: string;

beforeAll(async () => {
  regular = await prisma.user.create({
    data: { email: `sweep-regular-${tag}@t.local`, username: `sweep_regular_${tag}`, passwordHash: "x" },
  });
  lurker = await guest("lurker", EXPIRED);
  talker = await guest("talker", EXPIRED);
  fresh = await guest("fresh", ACTIVE);

  const server = await prisma.server.create({
    data: {
      name: "Sweep camp",
      ownerId: regular.id,
      members: {
        create: [
          { userId: regular.id, role: "owner" },
          { userId: lurker.id, role: "member" },
          { userId: talker.id, role: "member" },
          { userId: fresh.id, role: "member" },
        ],
      },
    },
  });
  serverId = server.id;
  const talkerServer = await prisma.server.create({
    data: { name: "Guest-owned", ownerId: talker.id, members: { create: [{ userId: talker.id, role: "owner" }] } },
  });
  talkerServerId = talkerServer.id;

  const general = await prisma.channel.create({ data: { serverId, name: "general" } });
  const notice = await prisma.message.create({
    data: { channelId: general.id, authorId: lurker.id, content: `lurker#${tag} joined the server`, isSystem: true },
  });
  joinNoticeId = notice.id;
  replyId = (await prisma.message.create({
    data: { channelId: general.id, authorId: regular.id, content: "welcome!", replyToId: notice.id },
  })).id;
  await prisma.reaction.create({ data: { messageId: replyId, userId: lurker.id, emoji: "🔥" } });
  await prisma.friendship.create({ data: { requesterId: lurker.id, addresseeId: regular.id } });

  talkerMessageId = (await prisma.message.create({
    data: { channelId: general.id, authorId: talker.id, content: "hello from a guest" },
  })).id;
  await prisma.friendship.create({ data: { requesterId: talker.id, addresseeId: regular.id, status: "accepted" } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("sweepExpiredGuests", () => {
  it("deletes a traceless guest, retires one whose messages others rely on, and skips active guests", async () => {
    const result = await sweepExpiredGuests(NOW);
    expect(result.deletedGuests).toBeGreaterThanOrEqual(1);
    expect(result.retiredGuests).toBeGreaterThanOrEqual(1);

    // Lurker: gone, along with their join notice and reaction; the reply survives unlinked.
    expect(await prisma.user.findUnique({ where: { id: lurker.id } })).toBeNull();
    expect(await prisma.message.findUnique({ where: { id: joinNoticeId } })).toBeNull();
    const reply = await prisma.message.findUnique({ where: { id: replyId } });
    expect(reply?.content).toBe("welcome!");
    expect(reply?.replyToId).toBeNull();
    expect(await prisma.reaction.count({ where: { userId: lurker.id } })).toBe(0);

    // Talker: row and message kept, no longer a member/friend, tokens revoked,
    // but still the owner-member of the server they own.
    const retired = await prisma.user.findUnique({ where: { id: talker.id } });
    expect(retired?.tokenVersion).toBe(talker.tokenVersion + 1);
    expect(await prisma.message.findUnique({ where: { id: talkerMessageId } })).not.toBeNull();
    expect(await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: talker.id } },
    })).toBeNull();
    expect(await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId: talkerServerId, userId: talker.id } },
    })).not.toBeNull();
    expect(await prisma.friendship.count({
      where: { OR: [{ requesterId: talker.id }, { addresseeId: talker.id }] },
    })).toBe(0);

    // Fresh guest: untouched.
    expect(await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: fresh.id } },
    })).not.toBeNull();
  });

  it("does not re-process a retired guest on the next pass", async () => {
    const before = await prisma.user.findUnique({ where: { id: talker.id }, select: { tokenVersion: true } });
    await sweepExpiredGuests(NOW);
    const after = await prisma.user.findUnique({ where: { id: talker.id }, select: { tokenVersion: true } });
    expect(after?.tokenVersion).toBe(before?.tokenVersion);
  });
});
