import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET as listBlocks, POST as blockUser } from "@/app/api/blocks/route";
import {
  DELETE as unblockUser,
  GET as getBlockStatus,
} from "@/app/api/blocks/[userId]/route";
import { POST as sendFriendRequest } from "@/app/api/friends/route";
import { PATCH as updateFriendship } from "@/app/api/friends/[friendshipId]/route";
import { POST as startDm } from "@/app/api/dm/route";
import { POST as sendDm } from "@/app/api/dm/[conversationId]/route";

interface TestUser {
  id: string;
  username: string;
}

let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  alice = await prisma.user.create({
    data: {
      email: `blocks-alice-${suffix}@t.local`,
      username: `blocks_alice_${suffix}`,
      passwordHash: "x",
    },
  });
  bob = await prisma.user.create({
    data: {
      email: `blocks-bob-${suffix}@t.local`,
      username: `blocks_bob_${suffix}`,
      passwordHash: "x",
    },
  });
  carol = await prisma.user.create({
    data: {
      email: `blocks-carol-${suffix}@t.local`,
      username: `blocks_carol_${suffix}`,
      passwordHash: "x",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function signIn(user: TestUser) {
  authMock.getSession.mockResolvedValue({
    userId: user.id,
    username: user.username,
  });
}

function postBlock(userId: string) {
  return blockUser(
    new Request("http://test.local/api/blocks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    }),
  );
}

function blockStatus(userId: string) {
  return getBlockStatus(new Request(`http://test.local/api/blocks/${userId}`), {
    params: Promise.resolve({ userId }),
  });
}

function removeBlock(userId: string) {
  return unblockUser(
    new Request(`http://test.local/api/blocks/${userId}`, { method: "DELETE" }),
    { params: Promise.resolve({ userId }) },
  );
}

function friendRequest(username: string) {
  return sendFriendRequest(
    new Request("http://test.local/api/friends", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username }),
    }),
  );
}

function openDm(targetUserId: string) {
  return startDm(
    new Request("http://test.local/api/dm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetUserId }),
    }),
  );
}

function postDm(conversationId: string, content: string) {
  return sendDm(
    new Request(`http://test.local/api/dm/${conversationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
    { params: Promise.resolve({ conversationId }) },
  );
}

describe("personal block controls", () => {
  it("requires authentication and rejects self or unknown targets", async () => {
    authMock.getSession.mockResolvedValue(null);
    expect((await listBlocks()).status).toBe(401);
    expect((await postBlock(bob.id)).status).toBe(401);
    expect((await blockStatus(bob.id)).status).toBe(401);
    expect((await removeBlock(bob.id)).status).toBe(401);

    signIn(alice);
    expect((await postBlock(alice.id)).status).toBe(400);
    expect((await postBlock(crypto.randomUUID())).status).toBe(404);
  });

  it("is directional and idempotent while removing existing friendships", async () => {
    await prisma.friendship.create({
      data: {
        requesterId: alice.id,
        addresseeId: bob.id,
        status: "accepted",
      },
    });

    signIn(alice);
    expect((await postBlock(bob.id)).status).toBe(200);
    expect((await postBlock(bob.id)).status).toBe(200);

    expect(
      await prisma.userBlock.count({
        where: { blockerId: alice.id, blockedId: bob.id },
      }),
    ).toBe(1);
    expect(
      await prisma.friendship.findFirst({
        where: {
          OR: [
            { requesterId: alice.id, addresseeId: bob.id },
            { requesterId: bob.id, addresseeId: alice.id },
          ],
        },
      }),
    ).toBeNull();

    expect(await (await blockStatus(bob.id)).json()).toEqual({ blocked: true });
    const listed = await (await listBlocks()).json();
    expect(listed.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user: expect.objectContaining({ id: bob.id }) }),
      ]),
    );

    signIn(bob);
    expect(await (await blockStatus(alice.id)).json()).toEqual({ blocked: false });
    expect((await (await listBlocks()).json()).blocks).toEqual([]);
    expect((await removeBlock(alice.id)).status).toBe(200);

    signIn(alice);
    expect(await (await blockStatus(bob.id)).json()).toEqual({ blocked: true });
  });

  it("denies new friend requests and direct messages in both directions", async () => {
    signIn(alice);
    expect((await friendRequest(bob.username)).status).toBe(403);
    expect((await openDm(bob.id)).status).toBe(403);

    signIn(bob);
    expect((await friendRequest(alice.username)).status).toBe(403);
    expect((await openDm(alice.id)).status).toBe(403);

    const [user1Id, user2Id] = [alice.id, bob.id].sort();
    const conversation = await prisma.conversation.create({
      data: { user1Id, user2Id },
    });

    signIn(alice);
    expect((await postDm(conversation.id, "blocked from Alice")).status).toBe(403);
    signIn(bob);
    expect((await postDm(conversation.id, "blocked from Bob")).status).toBe(403);
    expect(
      await prisma.directMessage.count({ where: { conversationId: conversation.id } }),
    ).toBe(0);
  });

  it("unblocks idempotently and restores the ability to request friendship", async () => {
    signIn(alice);
    expect((await removeBlock(bob.id)).status).toBe(200);
    expect((await removeBlock(bob.id)).status).toBe(200);
    expect(await (await blockStatus(bob.id)).json()).toEqual({ blocked: false });
    expect((await friendRequest(bob.username)).status).toBe(200);
  });

  it("converts the legacy incoming-request block action into a personal block", async () => {
    const friendship = await prisma.friendship.create({
      data: { requesterId: carol.id, addresseeId: bob.id },
    });
    signIn(bob);

    const response = await updateFriendship(
      new Request(`http://test.local/api/friends/${friendship.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "block" }),
      }),
      { params: Promise.resolve({ friendshipId: friendship.id }) },
    );

    expect(response.status).toBe(200);
    expect(await prisma.friendship.findUnique({ where: { id: friendship.id } })).toBeNull();
    expect(
      await prisma.userBlock.findUnique({
        where: {
          blockerId_blockedId: { blockerId: bob.id, blockedId: carol.id },
        },
      }),
    ).not.toBeNull();
  });
});
