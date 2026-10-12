import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

// Trail Boards: board channels, topics (root message + BoardTopic row),
// replies through the ordinary message route, ownership rules, and search.

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { POST as createChannel } from "@/app/api/channels/route";
import { GET as listTopics, POST as createTopic } from "@/app/api/boards/[channelId]/topics/route";
import { GET as getTopic, PATCH as patchTopic } from "@/app/api/boards/[channelId]/topics/[topicId]/route";
import { POST as postMessage } from "@/app/api/messages/route";
import { normalizeTag, parseTopicTags, parseTopicTitle } from "@/lib/boards";

const tag = Math.random().toString(36).slice(2, 8);

type U = { id: string; username: string };
let owner: U, mod: U, member: U, member2: U, outsider: U;
let serverId: string;
let boardId: string;
let textId: string;

function signIn(user: U) {
  authMock.getSession.mockResolvedValue({ userId: user.id, username: user.username });
}

function json(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function list(query = "", channelId = boardId) {
  return listTopics(new NextRequest(`http://test.local/api/boards/${channelId}/topics${query}`), {
    params: Promise.resolve({ channelId }),
  }).then(async (res) => ({ status: res.status, data: await res.json() }));
}

function open(body: unknown, channelId = boardId) {
  return createTopic(json(`http://test.local/api/boards/${channelId}/topics`, "POST", body), {
    params: Promise.resolve({ channelId }),
  });
}

function patch(topicId: string, body: unknown, channelId = boardId) {
  return patchTopic(json(`http://test.local/api/boards/${channelId}/topics/${topicId}`, "PATCH", body), {
    params: Promise.resolve({ channelId, topicId }),
  });
}

function detail(topicId: string, channelId = boardId) {
  return getTopic(new NextRequest(`http://test.local/api/boards/${channelId}/topics/${topicId}`), {
    params: Promise.resolve({ channelId, topicId }),
  });
}

function reply(channelId: string, parentMessageId: string | undefined, content: string) {
  return postMessage(new Request("http://test.local/api/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify({ channelId, content, ...(parentMessageId ? { parentMessageId } : {}) }),
  }));
}

async function openOk(title: string, content: string, tags: string[] = [], user: U = member) {
  signIn(user);
  const res = await open({ title, content, tags });
  expect(res.status).toBe(201);
  return (await res.json()) as { topic: { id: string; rootMessageId: string }; message: { id: string } };
}

beforeAll(async () => {
  [owner, mod, member, member2, outsider] = await Promise.all(
    ["owner", "mod", "member", "member2", "outsider"].map((name) =>
      prisma.user.create({
        data: { email: `tb-${name}-${tag}@t.local`, username: `tb_${name}_${tag}`, passwordHash: "x" },
        select: { id: true, username: true },
      }),
    ),
  );
  const server = await prisma.server.create({
    data: {
      name: "Trail Camp",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: mod.id, role: "mod" },
          { userId: member.id, role: "member" },
          { userId: member2.id, role: "member" },
        ],
      },
    },
  });
  serverId = server.id;
  textId = (await prisma.channel.create({ data: { serverId, name: "general" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("board channels", () => {
  it("creates a board through the channel route", async () => {
    signIn(owner);
    const res = await createChannel(new Request("http://test.local/api/channels", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ serverId, name: "Trail Board", type: "board", description: "Questions and guides" }),
    }));
    expect(res.status).toBe(201);
    const { channel } = await res.json();
    boardId = channel.id;
    expect(await prisma.channel.findUnique({ where: { id: boardId }, select: { type: true, name: true } }))
      .toEqual({ type: "board", name: "trail-board" });
  });

  it("validates titles and tags", () => {
    expect(parseTopicTitle("  Hi  ")).toBe("Hi".length >= 3 ? "Hi" : null);
    expect(parseTopicTitle("a".repeat(121))).toBeNull();
    expect(parseTopicTitle("How do   I   pitch a tent?")).toBe("How do I pitch a tent?");
    expect(normalizeTag("#Camp Fire")).toBe("camp-fire");
    expect(normalizeTag("bad tag!")).toBeNull();
    expect(parseTopicTags(["Gear", "gear", " Tents "])).toEqual(["gear", "tents"]);
    expect(parseTopicTags("a,b,c,d,e,f")).toBeNull();
    expect(parseTopicTags(["ok", ""])).toEqual(["ok"]);
    expect(parseTopicTags(42)).toBeNull();
  });
});

describe("topics", () => {
  let topicId: string;
  let rootId: string;

  it("only members with send access open topics, only on boards", async () => {
    signIn(outsider);
    expect((await open({ title: "Outside looking in", content: "hello" })).status).toBe(404);
    signIn(member);
    expect((await open({ title: "Not a board", content: "hello" }, textId)).status).toBe(404);
    expect((await open({ title: "no", content: "too short a title" })).status).toBe(400);
    expect((await open({ title: "Fine title", content: "   " })).status).toBe(400);
    expect((await open({ title: "Fine title", content: "x", tags: ["bad tag!"] })).status).toBe(400);
  });

  it("opens a topic as a root message plus a BoardTopic owned by the author", async () => {
    const created = await openOk("Best stove for winter?", "Looking for something light.", ["gear", "Winter"]);
    topicId = created.topic.id;
    rootId = created.topic.rootMessageId;
    expect(created.message.id).toBe(rootId);
    expect(created.topic).toMatchObject({
      title: "Best stove for winter?",
      tags: ["gear", "winter"],
      status: "open",
      pinned: false,
      owner: { id: member.id },
      author: { id: member.id },
      replyCount: 0,
      snippet: "Looking for something light.",
    });
    expect(await prisma.message.findUnique({ where: { id: rootId }, select: { channelId: true, parentMessageId: true } }))
      .toEqual({ channelId: boardId, parentMessageId: null });
  });

  it("replies go under a topic root through the message route and bump activity", async () => {
    signIn(member2);
    expect((await reply(boardId, undefined, "a bare root post")).status).toBe(400);
    const before = (await prisma.boardTopic.findUniqueOrThrow({ where: { id: topicId } })).lastActivityAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const res = await reply(boardId, rootId, "Try the pocket rocket.");
    expect(res.status).toBe(201);
    const { message } = await res.json();
    expect(message.parentMessageId).toBe(rootId);
    const after = (await prisma.boardTopic.findUniqueOrThrow({ where: { id: topicId } })).lastActivityAt;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
    // Nested threads are not a thing on a board: replies hang off the topic root only.
    expect((await reply(boardId, message.id, "reply to a reply")).status).toBe(400);

    const view = await (await detail(topicId)).json();
    expect(view.topic.replyCount).toBe(1);
    expect(view.message).toMatchObject({ id: rootId, content: "Looking for something light.", replyCount: 1 });
  });

  it("the owner edits, resolves and reopens; others may not", async () => {
    signIn(member2);
    expect((await patch(topicId, { title: "Hijacked" })).status).toBe(403);
    signIn(member);
    expect((await patch(topicId, {})).status).toBe(400);
    expect((await patch(topicId, { status: "sideways" })).status).toBe(400);
    let res = await patch(topicId, { title: "Best stove for winter trips?", tags: ["gear", "winter", "stoves"], status: "resolved" });
    expect(res.status).toBe(200);
    expect((await res.json()).topic).toMatchObject({ title: "Best stove for winter trips?", tags: ["gear", "winter", "stoves"], status: "resolved" });
    expect((await prisma.boardTopic.findUniqueOrThrow({ where: { id: topicId } })).resolvedAt).not.toBeNull();
    res = await patch(topicId, { status: "open" });
    expect((await res.json()).topic).toMatchObject({ status: "open", resolvedAt: null });
    // Owner powers stop at archive, pin and hand-over.
    expect((await patch(topicId, { status: "archived" })).status).toBe(403);
    expect((await patch(topicId, { pinned: true })).status).toBe(403);
    expect((await patch(topicId, { ownerId: member2.id })).status).toBe(403);
  });

  it("a moderator pins, hands over, archives (no more replies) and unarchives", async () => {
    signIn(mod);
    expect((await patch(topicId, { ownerId: outsider.id })).status).toBe(400);
    const res = await patch(topicId, { pinned: true, ownerId: member2.id });
    expect(res.status).toBe(200);
    expect((await res.json()).topic).toMatchObject({ pinned: true, owner: { id: member2.id } });
    // The new owner runs it now; the old one is just a member.
    signIn(member);
    expect((await patch(topicId, { title: "No longer mine" })).status).toBe(403);
    signIn(member2);
    expect((await patch(topicId, { tags: ["gear"] })).status).toBe(200);

    signIn(mod);
    expect((await patch(topicId, { status: "archived" })).status).toBe(200);
    signIn(member2);
    expect((await reply(boardId, rootId, "one more?")).status).toBe(403);
    expect((await patch(topicId, { status: "open" })).status).toBe(403); // owner can't unarchive
    signIn(mod);
    expect((await patch(topicId, { status: "open" })).status).toBe(200);
  });

  it("lists pinned first, filters by status and tag, searches titles, and counts tags", async () => {
    const t2 = await openOk("Trail etiquette", "Yield to uphill hikers.", ["etiquette"]);
    const t3 = await openOk("Resolved already", "Answered in the FAQ.", ["gear"], member2);
    signIn(member2);
    expect((await patch(t3.topic.id, { status: "resolved" })).status).toBe(200);
    const t4 = await openOk("Old archived thing", "Gone stale.", ["gear"]);
    signIn(mod);
    expect((await patch(t4.topic.id, { status: "archived" })).status).toBe(200);

    signIn(member);
    const all = await list();
    expect(all.status).toBe(200);
    const ids = all.data.topics.map((t: { id: string }) => t.id);
    expect(ids[0]).toBe(topicId); // pinned
    expect(ids).toContain(t2.topic.id);
    expect(ids).toContain(t3.topic.id);
    expect(ids).not.toContain(t4.topic.id); // archived hidden by default
    expect(all.data.tags).toEqual(expect.arrayContaining([{ tag: "gear", count: 2 }, { tag: "etiquette", count: 1 }]));

    expect((await list("?status=archived")).data.topics.map((t: { id: string }) => t.id)).toEqual([t4.topic.id]);
    expect((await list("?status=resolved")).data.topics.map((t: { id: string }) => t.id)).toEqual([t3.topic.id]);
    expect((await list("?status=all")).data.topics.map((t: { id: string }) => t.id)).toEqual(expect.arrayContaining([topicId, t2.topic.id, t3.topic.id, t4.topic.id]));
    expect((await list("?tag=etiquette")).data.topics.map((t: { id: string }) => t.id)).toEqual([t2.topic.id]);
    expect((await list("?q=uphill")).data.topics.map((t: { id: string }) => t.id)).toEqual([t2.topic.id]);
    expect((await list("?q=STOVE")).data.topics.map((t: { id: string }) => t.id)).toEqual([topicId]);
    expect((await list("", textId)).status).toBe(404);
    signIn(outsider);
    expect((await list()).status).toBe(404);
  });

  it("deleting the root message takes the topic with it", async () => {
    const doomed = await openOk("Delete me", "Oops.", []);
    await prisma.message.delete({ where: { id: doomed.topic.rootMessageId } });
    expect(await prisma.boardTopic.findUnique({ where: { id: doomed.topic.id } })).toBeNull();
  });
});
