import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET as listConversations } from "@/app/api/dm/route";
import { GET as getUnreadTotal } from "@/app/api/dm/unread/route";
import {
  GET as getConversationMessages,
  POST as postDirectMessage,
} from "@/app/api/dm/[conversationId]/route";
import { POST as markConversationRead } from "@/app/api/dm/[conversationId]/read/route";

interface TestUser {
  id: string;
  username: string;
}

let alice: TestUser;
let bob: TestUser;
let carol: TestUser;
let aliceBobId: string;
let aliceCarolId: string;

function signIn(user: TestUser | null) {
  authMock.getSession.mockResolvedValue(user ? { userId: user.id, username: user.username } : null);
}

function params(conversationId: string) {
  return { params: Promise.resolve({ conversationId }) };
}

function markRead(conversationId: string) {
  return markConversationRead(
    new Request(`http://test.local/api/dm/${conversationId}/read`, { method: "POST" }),
    params(conversationId),
  );
}

function postDm(conversationId: string, body: Record<string, unknown>) {
  return postDirectMessage(
    new Request(`http://test.local/api/dm/${conversationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params(conversationId),
  );
}

async function unreadTotal(): Promise<number> {
  const response = await getUnreadTotal();
  expect(response.status).toBe(200);
  return (await response.json()).total;
}

async function unreadByConversation(): Promise<Record<string, number>> {
  const response = await listConversations();
  expect(response.status).toBe(200);
  const { conversations } = await response.json();
  return Object.fromEntries(
    conversations.map((c: { id: string; unreadCount: number }) => [c.id, c.unreadCount]),
  );
}

async function pendingUpload(ownerId: string) {
  return prisma.privateUpload.create({
    data: {
      ownerId,
      storageKey: `${crypto.randomUUID()}.txt`,
      originalName: "notes.txt",
      contentType: "text/plain",
      byteSize: 5,
    },
  });
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [alice, bob, carol] = await Promise.all(
    ["alice", "bob", "carol"].map((label) =>
      prisma.user.create({
        data: {
          email: `dm-read-${label}-${suffix}@t.local`,
          username: `dm_read_${label}_${suffix}`,
          passwordHash: "x",
        },
      }),
    ),
  );
  aliceBobId = (await prisma.conversation.create({
    data: { user1Id: alice.id, user2Id: bob.id },
  })).id;
  aliceCarolId = (await prisma.conversation.create({
    data: { user1Id: alice.id, user2Id: carol.id },
  })).id;
  await prisma.directMessage.createMany({
    data: [
      { conversationId: aliceBobId, authorId: bob.id, content: "hey" },
      { conversationId: aliceBobId, authorId: bob.id, content: "you there?" },
      { conversationId: aliceBobId, authorId: alice.id, content: "yep" },
      { conversationId: aliceCarolId, authorId: carol.id, content: "hi alice" },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("DM unread counts", () => {
  it("counts only the other participant's unread messages per conversation and in total", async () => {
    signIn(alice);
    expect(await unreadByConversation()).toEqual({ [aliceBobId]: 2, [aliceCarolId]: 1 });
    expect(await unreadTotal()).toBe(3);

    signIn(bob);
    expect(await unreadByConversation()).toEqual({ [aliceBobId]: 1 });
    expect(await unreadTotal()).toBe(1);

    signIn(carol);
    expect(await unreadTotal()).toBe(0);
  });

  it("requires a session", async () => {
    signIn(null);
    expect((await getUnreadTotal()).status).toBe(401);
    expect((await markRead(aliceBobId)).status).toBe(401);
  });
});

describe("POST /api/dm/[conversationId]/read", () => {
  it("rejects non-participants without touching read state", async () => {
    signIn(carol);
    expect((await markRead(aliceBobId)).status).toBe(403);
    await expect(prisma.directMessage.count({
      where: { conversationId: aliceBobId, readAt: { not: null } },
    })).resolves.toBe(0);

    expect((await markRead(crypto.randomUUID())).status).toBe(404);
  });

  it("marks only the other participant's messages read", async () => {
    signIn(alice);
    const response = await markRead(aliceBobId);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ marked: 2 });

    expect(await unreadByConversation()).toEqual({ [aliceBobId]: 0, [aliceCarolId]: 1 });
    expect(await unreadTotal()).toBe(1);

    // Alice's own message is still unread for Bob.
    signIn(bob);
    expect(await unreadTotal()).toBe(1);

    // Idempotent.
    signIn(alice);
    await expect((await markRead(aliceBobId)).json()).resolves.toEqual({ marked: 0 });
  });

  it("does not expose readAt as a read receipt in message payloads", async () => {
    signIn(bob);
    const response = await getConversationMessages(
      new Request(`http://test.local/api/dm/${aliceBobId}`),
      params(aliceBobId),
    );
    expect(response.status).toBe(200);
    const { messages } = await response.json();
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) expect(message).not.toHaveProperty("readAt");
  });
});

describe("DM attachment claims", () => {
  it("lets a participant attach their own upload", async () => {
    const upload = await pendingUpload(alice.id);
    signIn(alice);
    const response = await postDm(aliceBobId, { attachmentId: upload.id });
    expect(response.status).toBe(200);
    const { message } = await response.json();
    expect(message).toMatchObject({ privateUploadId: upload.id, content: "" });
    expect(message).not.toHaveProperty("readAt");
    // A new message from Alice shows up unread for Bob.
    signIn(bob);
    expect(await unreadTotal()).toBe(2);
  });

  it("rejects outsiders, other people's uploads, and blocked pairs", async () => {
    const carolsUpload = await pendingUpload(carol.id);
    signIn(carol);
    expect((await postDm(aliceBobId, { attachmentId: carolsUpload.id })).status).toBe(403);

    const alicesUpload = await pendingUpload(alice.id);
    signIn(bob);
    expect((await postDm(aliceBobId, { attachmentId: alicesUpload.id })).status).toBe(400);

    const block = await prisma.userBlock.create({
      data: { blockerId: bob.id, blockedId: alice.id },
    });
    try {
      signIn(alice);
      expect((await postDm(aliceBobId, { attachmentId: alicesUpload.id })).status).toBe(403);
    } finally {
      await prisma.userBlock.delete({ where: { id: block.id } });
    }

    for (const id of [carolsUpload.id, alicesUpload.id]) {
      await expect(prisma.privateUpload.findUniqueOrThrow({ where: { id } }))
        .resolves.toMatchObject({ state: "pending", claimKind: null, claimId: null });
    }
  });
});
