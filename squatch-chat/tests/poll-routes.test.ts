import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { POST as createPoll } from "@/app/api/polls/route";
import {
  DELETE as closePoll,
  GET as getPoll,
  POST as votePoll,
} from "@/app/api/polls/[pollId]/route";

interface TestUser { id: string; username: string }
let owner: TestUser;
let member: TestUser;
let moderator: TestUser;
let outsider: TestUser;
let serverId: string;
let channelId: string;
let otherChannelId: string;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [owner, member, moderator, outsider] = await Promise.all(
    ["owner", "member", "moderator", "outsider"].map((name) =>
      prisma.user.create({
        data: {
          email: `poll-${name}-${suffix}@t.local`,
          username: `poll_${name}_${suffix}`,
          passwordHash: "x",
        },
      }),
    ),
  );
  const server = await prisma.server.create({
    data: {
      name: "Poll Route Tests",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: member.id, role: "member" },
          { userId: moderator.id, role: "mod" },
        ],
      },
    },
  });
  serverId = server.id;
  channelId = (await prisma.channel.create({ data: { serverId, name: "votes", type: "text" } })).id;
  const otherServer = await prisma.server.create({
    data: {
      name: "Other Poll Server",
      ownerId: outsider.id,
      members: { create: { userId: outsider.id, role: "owner" } },
    },
  });
  otherChannelId = (await prisma.channel.create({ data: { serverId: otherServer.id, name: "other", type: "text" } })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function signIn(user: TestUser | null) {
  authMock.getSession.mockResolvedValue(user ? { userId: user.id, username: user.username } : null);
}

function pollParams(pollId: string) {
  return { params: Promise.resolve({ pollId }) };
}

function request(method: string, body?: unknown) {
  return new Request("http://test.local/api/polls", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function makePoll(allowMultiple = false) {
  signIn(owner);
  const response = await createPoll(request("POST", {
    channelId,
    question: allowMultiple ? "Pick several trails" : "Pick one trail",
    options: ["North", "South", "West"],
    allowMultiple,
  }));
  expect(response.status).toBe(201);
  return (await response.json()).poll as {
    id: string;
    messageId: string;
    options: Array<{ id: string }>;
  };
}

describe("Camp Vote routes", () => {
  it("requires authentication and active channel membership", async () => {
    signIn(null);
    expect((await createPoll(request("POST", { channelId, question: "Q", options: ["A", "B"] }))).status).toBe(401);
    signIn(outsider);
    expect((await createPoll(request("POST", { channelId, question: "Q", options: ["A", "B"] }))).status).toBe(403);
  });

  it("creates an atomic message-backed poll visible through the read route", async () => {
    const poll = await makePoll();
    expect(await prisma.message.findUnique({ where: { id: poll.messageId } })).not.toBeNull();
    signIn(member);
    const response = await getPoll(new Request("http://test.local"), pollParams(poll.id));
    expect(response.status).toBe(200);
    expect((await response.json()).poll.options).toHaveLength(3);
  });

  it("enforces one selection for single-choice polls and rejects foreign options", async () => {
    const poll = await makePoll();
    const foreign = await makePoll();
    signIn(member);
    expect((await votePoll(request("POST", { optionId: poll.options[0].id }), pollParams(poll.id))).status).toBe(200);
    expect((await votePoll(request("POST", { optionId: poll.options[1].id }), pollParams(poll.id))).status).toBe(200);
    expect(await prisma.pollVote.count({ where: { pollId: poll.id, userId: member.id } })).toBe(1);
    expect((await votePoll(request("POST", { optionId: foreign.options[0].id }), pollParams(poll.id))).status).toBe(400);
  });

  it("keeps concurrent single-choice votes to one committed selection", async () => {
    const poll = await makePoll();
    signIn(member);

    const responses = await Promise.all([
      votePoll(request("POST", { optionId: poll.options[0].id }), pollParams(poll.id)),
      votePoll(request("POST", { optionId: poll.options[1].id }), pollParams(poll.id)),
    ]);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(await prisma.pollVote.count({ where: { pollId: poll.id, userId: member.id } })).toBe(1);
  });

  it("supports multiple selections and toggle-off", async () => {
    const poll = await makePoll(true);
    signIn(member);
    await votePoll(request("POST", { optionId: poll.options[0].id }), pollParams(poll.id));
    await votePoll(request("POST", { optionId: poll.options[1].id }), pollParams(poll.id));
    expect(await prisma.pollVote.count({ where: { pollId: poll.id, userId: member.id } })).toBe(2);
    await votePoll(request("POST", { optionId: poll.options[0].id }), pollParams(poll.id));
    expect(await prisma.pollVote.count({ where: { pollId: poll.id, userId: member.id } })).toBe(1);
  });

  it("allows creator or MANAGE_MESSAGES moderator to close and rejects a regular member", async () => {
    const poll = await makePoll();
    signIn(member);
    expect((await closePoll(request("DELETE"), pollParams(poll.id))).status).toBe(403);
    signIn(moderator);
    expect((await closePoll(request("DELETE"), pollParams(poll.id))).status).toBe(200);
    signIn(member);
    expect((await votePoll(request("POST", { optionId: poll.options[0].id }), pollParams(poll.id))).status).toBe(409);
  });

  it("cannot create or read a poll in another server's channel", async () => {
    signIn(member);
    expect((await createPoll(request("POST", { channelId: otherChannelId, question: "Q", options: ["A", "B"] }))).status).toBe(403);
  });
});
