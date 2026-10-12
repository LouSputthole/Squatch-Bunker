import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { sweepExpiredMessages } from "@/lib/messageRetention";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET as listMessages } from "@/app/api/messages/route";
import {
  DELETE as deleteMessage,
  PATCH as patchMessage,
} from "@/app/api/messages/[messageId]/route";
import { POST as purgeMessages } from "@/app/api/messages/purge/route";
import { GET as listDirectMessages } from "@/app/api/dm/[conversationId]/route";

let ownerId: string;
let memberId: string;
let serverId: string;
let channelId: string;

const BASE = Date.parse("2026-01-01T00:00:00.000Z");

function signIn(userId: string) {
  authMock.getSession.mockResolvedValue({ userId, username: "history" });
}

async function history(query: string) {
  return listMessages(new Request(`http://test.local/api/messages?${query}`));
}

async function makeChannel(name: string, retentionDays: number | null = null) {
  return prisma.channel.create({
    data: { serverId, name: `${name}-${Math.random().toString(36).slice(2, 8)}`, retentionDays },
  });
}

async function makeMessage(
  channel: string,
  content: string,
  at: number,
  extra: { parentMessageId?: string; authorId?: string } = {},
) {
  return prisma.message.create({
    data: {
      channelId: channel,
      authorId: extra.authorId ?? ownerId,
      content,
      createdAt: new Date(at),
      ...(extra.parentMessageId ? { parentMessageId: extra.parentMessageId } : {}),
    },
  });
}

beforeAll(async () => {
  const suffix = Math.random().toString(36).slice(2);
  const [owner, member] = await Promise.all([
    prisma.user.create({
      data: { email: `history-owner-${suffix}@t.local`, username: `history_owner_${suffix}`, passwordHash: "x" },
    }),
    prisma.user.create({
      data: { email: `history-member-${suffix}@t.local`, username: `history_member_${suffix}`, passwordHash: "x" },
    }),
  ]);
  ownerId = owner.id;
  memberId = member.id;
  const server = await prisma.server.create({ data: { name: "History", ownerId } });
  serverId = server.id;
  await prisma.serverMember.createMany({
    data: [
      { serverId, userId: ownerId, role: "owner" },
      { serverId, userId: memberId, role: "member" },
    ],
  });
  channelId = (await makeChannel("history")).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/messages paging", () => {
  it("pages from newest to oldest with nextCursor = the page's oldest message", async () => {
    signIn(ownerId);
    const pagingChannel = (await makeChannel("paging")).id;
    // 120 messages; every pair shares a timestamp so the id tiebreaker matters.
    const created = [];
    for (let i = 0; i < 120; i += 1) {
      created.push(await makeMessage(pagingChannel, `m${i}`, BASE + Math.floor(i / 2) * 1000));
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const response = await history(
        `channelId=${pagingChannel}${cursor ? `&cursor=${cursor}` : ""}`,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      const ids = body.messages.map((m: { id: string }) => m.id);
      if (body.nextCursor) expect(body.nextCursor).toBe(ids[0]);
      seen.unshift(...ids);
      cursor = body.nextCursor;
      pages += 1;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(cursor).toBeNull();
    expect(new Set(seen).size).toBe(120);
    expect(seen).toHaveLength(120);
    // Each page is ascending and pages join without gaps or repeats.
    const ordered = [...created].sort((a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    expect(seen).toEqual(ordered.map((m) => m.id));
  });

  it("returns null nextCursor when the first page holds everything, and replyCount per message", async () => {
    signIn(ownerId);
    const small = (await makeChannel("small")).id;
    const parent = await makeMessage(small, "parent", BASE);
    await makeMessage(small, "reply one", BASE + 1, { parentMessageId: parent.id });
    await makeMessage(small, "reply two", BASE + 2, { parentMessageId: parent.id });

    const body = await (await history(`channelId=${small}`)).json();
    expect(body.nextCursor).toBeNull();
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ id: parent.id, replyCount: 2, reactions: {} });
    expect(body.messages[0]).not.toHaveProperty("_count");
  });

  it("rejects a cursor that is not a message in this channel", async () => {
    signIn(ownerId);
    const other = await makeMessage((await makeChannel("other")).id, "elsewhere", BASE);
    expect((await history(`channelId=${channelId}&cursor=${other.id}`)).status).toBe(400);
  });
});

describe("PATCH /api/messages/:id", () => {
  it("caps edits and returns the same shape as a history item", async () => {
    signIn(ownerId);
    const message = await makeMessage(channelId, "original", BASE);
    await makeMessage(channelId, "a reply", BASE + 1, { parentMessageId: message.id });
    await prisma.reaction.create({ data: { messageId: message.id, userId: memberId, emoji: "🔥" } });
    const params = { params: Promise.resolve({ messageId: message.id }) };

    const tooLong = await patchMessage(
      new Request("http://test.local", { method: "PATCH", body: JSON.stringify({ content: "x".repeat(4001) }) }),
      params,
    );
    expect(tooLong.status).toBe(400);

    const edited = await patchMessage(
      new Request("http://test.local", { method: "PATCH", body: JSON.stringify({ content: " edited " }) }),
      params,
    );
    expect(edited.status).toBe(200);
    const { message: payload } = await edited.json();
    expect(payload).toMatchObject({
      id: message.id,
      content: "edited",
      replyCount: 1,
      replyTo: null,
      poll: null,
      attachmentUrl: null,
      reactions: { "🔥": { count: 1, userIds: [memberId] } },
      author: { id: ownerId },
    });
    expect(payload.editedAt).toBeTruthy();
  });
});

describe("deleting a thread parent", () => {
  it("DELETE removes the parent with its nested replies and their reactions", async () => {
    signIn(ownerId);
    const parent = await makeMessage(channelId, "thread root", BASE);
    const reply = await makeMessage(channelId, "reply", BASE + 1, { parentMessageId: parent.id, authorId: memberId });
    const nested = await makeMessage(channelId, "nested", BASE + 2, { parentMessageId: reply.id });
    const bystander = await makeMessage(channelId, "unrelated", BASE + 3);
    await prisma.reaction.create({ data: { messageId: reply.id, userId: ownerId, emoji: "👍" } });
    await prisma.bookmark.create({ data: { messageId: nested.id, userId: memberId } });

    const response = await deleteMessage(
      new Request("http://test.local", { method: "DELETE" }),
      { params: Promise.resolve({ messageId: parent.id }) },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(new Set(body.deletedMessageIds)).toEqual(new Set([parent.id, reply.id, nested.id]));

    expect(await prisma.message.count({ where: { id: { in: [parent.id, reply.id, nested.id] } } })).toBe(0);
    expect(await prisma.reaction.count({ where: { messageId: reply.id } })).toBe(0);
    expect(await prisma.bookmark.count({ where: { messageId: nested.id } })).toBe(0);
    expect(await prisma.message.findUnique({ where: { id: bystander.id } })).not.toBeNull();
  });

  it("a plain member can't take other members' replies down with their thread starter", async () => {
    signIn(memberId);
    const parent = await makeMessage(channelId, "member root", BASE + 10, { authorId: memberId });
    const othersReply = await makeMessage(channelId, "owner reply", BASE + 11, { parentMessageId: parent.id, authorId: ownerId });

    const refused = await deleteMessage(
      new Request("http://test.local", { method: "DELETE" }),
      { params: Promise.resolve({ messageId: parent.id }) },
    );
    expect(refused.status).toBe(409);
    expect(await prisma.message.count({ where: { id: { in: [parent.id, othersReply.id] } } })).toBe(2);

    // A thread holding only the author's own replies still goes in one delete.
    const solo = await makeMessage(channelId, "solo root", BASE + 12, { authorId: memberId });
    const ownReply = await makeMessage(channelId, "own reply", BASE + 13, { parentMessageId: solo.id, authorId: memberId });
    const allowed = await deleteMessage(
      new Request("http://test.local", { method: "DELETE" }),
      { params: Promise.resolve({ messageId: solo.id }) },
    );
    expect(allowed.status).toBe(200);
    expect(await prisma.message.count({ where: { id: { in: [solo.id, ownReply.id] } } })).toBe(0);
  });

  it("purge takes the replies of purged parents with it", async () => {
    signIn(ownerId);
    const purgeChannel = (await makeChannel("purge")).id;
    const kept = await makeMessage(purgeChannel, "kept root", BASE);
    const keptReply = await makeMessage(purgeChannel, "kept reply", BASE + 1, { parentMessageId: kept.id });
    const parent = await makeMessage(purgeChannel, "purged root", BASE + 2, { authorId: memberId });
    const reply = await makeMessage(purgeChannel, "reply to purged", BASE + 3, { parentMessageId: parent.id });

    const response = await purgeMessages(
      new Request("http://test.local/api/messages/purge", {
        method: "POST",
        body: JSON.stringify({ channelId: purgeChannel, count: 1, userId: memberId }),
      }) as never,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(new Set(body.messageIds)).toEqual(new Set([parent.id, reply.id]));
    expect(body.deleted).toBe(2);
    expect(await prisma.message.count({ where: { id: { in: [kept.id, keptReply.id] } } })).toBe(2);
  });

  it("retention expires a thread parent's replies with it, even recent ones", async () => {
    const now = new Date("2026-07-12T18:00:00.000Z");
    const trail = (await makeChannel("trail", 1)).id;
    const parent = await makeMessage(trail, "old root", now.getTime() - 3 * 86_400_000);
    const recentReply = await makeMessage(trail, "recent reply", now.getTime() - 60_000, {
      parentMessageId: parent.id,
    });
    const recent = await makeMessage(trail, "recent", now.getTime() - 60_000);

    await sweepExpiredMessages(now);

    expect(await prisma.message.findUnique({ where: { id: parent.id } })).toBeNull();
    expect(await prisma.message.findUnique({ where: { id: recentReply.id } })).toBeNull();
    expect(await prisma.message.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});

describe("GET /api/dm/:conversationId paging", () => {
  it("uses the same oldest-id cursor contract as channel history", async () => {
    const [user1Id, user2Id] = [ownerId, memberId].sort();
    const conversation = await prisma.conversation.create({ data: { user1Id, user2Id } });
    for (let i = 0; i < 5; i += 1) {
      await prisma.directMessage.create({
        data: { conversationId: conversation.id, authorId: ownerId, content: `dm${i}`, createdAt: new Date(BASE + i) },
      });
    }
    signIn(memberId);
    const params = { params: Promise.resolve({ conversationId: conversation.id }) };
    const page = (query: string) =>
      listDirectMessages(new Request(`http://test.local/api/dm/${conversation.id}?${query}`), params);

    const first = await (await page("limit=3")).json();
    expect(first.messages.map((m: { content: string }) => m.content)).toEqual(["dm2", "dm3", "dm4"]);
    expect(first.nextCursor).toBe(first.messages[0].id);

    const second = await (await page(`limit=3&cursor=${first.nextCursor}`)).json();
    expect(second.messages.map((m: { content: string }) => m.content)).toEqual(["dm0", "dm1"]);
    expect(second.nextCursor).toBeNull();

    expect((await page("cursor=not-a-message")).status).toBe(400);
  });
});
