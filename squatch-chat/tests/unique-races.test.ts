import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { POST as react } from "@/app/api/messages/[messageId]/reactions/route";
import { POST as vote } from "@/app/api/polls/[pollId]/route";
import { POST as openDm } from "@/app/api/dm/route";
import { POST as createEmoji } from "@/app/api/servers/[serverId]/emoji/route";
import {
  DELETE as removeBookmark,
  POST as addBookmark,
} from "@/app/api/bookmarks/route";

let ownerId: string;
let friendId: string;
let serverId: string;
let channelId: string;

function json(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function makeMessage(content: string) {
  return prisma.message.create({ data: { channelId, authorId: ownerId, content } });
}

beforeAll(async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [owner, friend] = await Promise.all([
    prisma.user.create({
      data: { email: `race-owner-${suffix}@t.local`, username: `race_owner_${suffix}`, passwordHash: "x" },
    }),
    prisma.user.create({
      data: { email: `race-friend-${suffix}@t.local`, username: `race_friend_${suffix}`, passwordHash: "x" },
    }),
  ]);
  ownerId = owner.id;
  friendId = friend.id;
  const server = await prisma.server.create({ data: { name: "Races", ownerId } });
  serverId = server.id;
  await prisma.serverMember.createMany({
    data: [
      { serverId, userId: ownerId, role: "owner" },
      { serverId, userId: friendId },
    ],
  });
  channelId = (await prisma.channel.create({ data: { serverId, name: "races" } })).id;
  authMock.getSession.mockResolvedValue({ userId: ownerId, username: owner.username });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("double-submits resolve without 500s", () => {
  it("reaction double-click", async () => {
    const message = await makeMessage("react to me");
    const params = () => ({ params: Promise.resolve({ messageId: message.id }) });
    const url = `http://test.local/api/messages/${message.id}/reactions`;
    const responses = await Promise.all([
      react(json(url, "POST", { emoji: "🔥" }), params()),
      react(json(url, "POST", { emoji: "🔥" }), params()),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await prisma.reaction.count({ where: { messageId: message.id } })).toBeLessThanOrEqual(1);

    expect((await react(json(url, "POST", { emoji: "x".repeat(65) }), params())).status).toBe(400);
  });

  it("multi-choice poll vote double-click", async () => {
    const message = await makeMessage("poll");
    const poll = await prisma.poll.create({
      data: {
        serverId,
        channelId,
        messageId: message.id,
        creatorId: ownerId,
        question: "Snacks?",
        allowMultiple: true,
        options: { create: [{ text: "S'mores", position: 0 }, { text: "Chili", position: 1 }] },
      },
      include: { options: true },
    });
    const optionId = poll.options[0].id;
    const params = () => ({ params: Promise.resolve({ pollId: poll.id }) });
    const url = `http://test.local/api/polls/${poll.id}`;
    const responses = await Promise.all([
      vote(new Request(url, { method: "POST", body: JSON.stringify({ optionId }) }), params()),
      vote(new Request(url, { method: "POST", body: JSON.stringify({ optionId }) }), params()),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await prisma.pollVote.count({ where: { pollId: poll.id } })).toBeLessThanOrEqual(1);
  });

  it("concurrent DM creation returns one conversation", async () => {
    const responses = await Promise.all([
      openDm(new Request("http://test.local/api/dm", { method: "POST", body: JSON.stringify({ targetUserId: friendId }) })),
      openDm(new Request("http://test.local/api/dm", { method: "POST", body: JSON.stringify({ targetUserId: friendId }) })),
    ]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    const [a, b] = await Promise.all(responses.map((r) => r.json()));
    expect(a.conversationId).toBe(b.conversationId);

    const bogus = await openDm(
      new Request("http://test.local/api/dm", { method: "POST", body: JSON.stringify({ targetUserId: 123 }) }),
    );
    expect(bogus.status).toBe(400);
  });

  it("duplicate custom emoji name is a 409", async () => {
    const url = `http://test.local/api/servers/${serverId}/emoji`;
    const params = () => ({ params: Promise.resolve({ serverId }) });
    const body = { name: "campfire", url: "https://example.test/campfire.png" };
    expect((await createEmoji(json(url, "POST", body), params())).status).toBe(201);
    const duplicate = await createEmoji(json(url, "POST", body), params());
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()).error).toMatch(/already exists/);
  });
});

describe("DELETE /api/bookmarks", () => {
  it("rejects a missing messageId instead of clearing every bookmark", async () => {
    const [first, second] = await Promise.all([makeMessage("keep 1"), makeMessage("keep 2")]);
    for (const message of [first, second]) {
      expect((await addBookmark(json("http://test.local/api/bookmarks", "POST", { messageId: message.id }))).status).toBe(201);
    }

    expect((await removeBookmark(json("http://test.local/api/bookmarks", "DELETE", {}))).status).toBe(400);
    expect((await removeBookmark(json("http://test.local/api/bookmarks", "DELETE", { messageId: 5 }))).status).toBe(400);
    expect(await prisma.bookmark.count({ where: { userId: ownerId } })).toBe(2);

    expect((await removeBookmark(json("http://test.local/api/bookmarks", "DELETE", { messageId: first.id }))).status).toBe(200);
    expect(await prisma.bookmark.count({ where: { userId: ownerId } })).toBe(1);
  });
});
