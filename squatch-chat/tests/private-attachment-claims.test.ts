import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { privateAttachmentUrl } from "@/lib/privateUploads";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { POST as postChannelMessage } from "@/app/api/messages/route";
import { POST as postDirectMessage } from "@/app/api/dm/[conversationId]/route";

interface TestUser {
  id: string;
  username: string;
}

let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let channelId: string;
let conversationId: string;

function signIn(user: TestUser) {
  authMock.getSession.mockResolvedValue({ userId: user.id, username: user.username });
}

function postChannel(body: Record<string, unknown>) {
  return postChannelMessage(new Request("http://test.local/api/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ channelId, ...body }),
  }));
}

function postDm(body: Record<string, unknown>) {
  return postDirectMessage(
    new Request(`http://test.local/api/dm/${conversationId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ conversationId }) },
  );
}

async function pendingUpload(userId: string, name = "private.txt") {
  return prisma.privateUpload.create({
    data: {
      ownerId: userId,
      storageKey: `${crypto.randomUUID()}.txt`,
      originalName: name,
      contentType: "text/plain",
      byteSize: 7,
    },
  });
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [owner, member, outsider] = await Promise.all(
    ["owner", "member", "outsider"].map((label) =>
      prisma.user.create({
        data: {
          email: `attachment-claim-${label}-${suffix}@t.local`,
          username: `attachment_claim_${label}_${suffix}`,
          passwordHash: "x",
        },
      }),
    ),
  );
  const server = await prisma.server.create({
    data: {
      name: "Private attachment claims",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: member.id, role: "member" },
        ],
      },
      channels: { create: { name: "attachments", type: "text" } },
    },
    include: { channels: true },
  });
  channelId = server.channels[0].id;
  conversationId = (await prisma.conversation.create({
    data: { user1Id: owner.id, user2Id: member.id },
  })).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("private attachment claims", () => {
  it("atomically claims an owned upload for one channel message", async () => {
    const upload = await pendingUpload(owner.id, "owner-map.txt");
    signIn(owner);
    const response = await postChannel({ attachmentId: upload.id });
    expect(response.status).toBe(201);
    const { message } = await response.json();
    expect(message).toMatchObject({
      privateUploadId: upload.id,
      attachmentUrl: privateAttachmentUrl(upload.id),
      attachmentName: "owner-map.txt",
    });
    await expect(prisma.privateUpload.findUniqueOrThrow({ where: { id: upload.id } }))
      .resolves.toMatchObject({
        state: "claimed",
        claimKind: "channel-message",
        claimId: message.id,
      });

    expect((await postChannel({ attachmentId: upload.id })).status).toBe(400);
  });

  it("does not let another user claim an upload", async () => {
    const upload = await pendingUpload(owner.id);
    signIn(member);
    expect((await postChannel({ attachmentId: upload.id })).status).toBe(400);
    await expect(prisma.privateUpload.findUniqueOrThrow({ where: { id: upload.id } }))
      .resolves.toMatchObject({ state: "pending", claimKind: null, claimId: null });
  });

  it("claims an owned upload for a direct message", async () => {
    const upload = await pendingUpload(owner.id, "dm-note.txt");
    signIn(owner);
    const response = await postDm({ attachmentId: upload.id });
    expect(response.status).toBe(200);
    const { message } = await response.json();
    expect(message).toMatchObject({
      privateUploadId: upload.id,
      attachmentUrl: privateAttachmentUrl(upload.id),
      attachmentName: "dm-note.txt",
    });
    await expect(prisma.privateUpload.findUniqueOrThrow({ where: { id: upload.id } }))
      .resolves.toMatchObject({
        state: "claimed",
        claimKind: "direct-message",
        claimId: message.id,
      });
  });

  it("rejects new legacy-local attachment URLs but preserves HTTPS embeds", async () => {
    signIn(owner);
    expect((await postChannel({ attachmentUrl: "/uploads/new-private.txt" })).status).toBe(400);
    expect((await postDm({ attachmentUrl: "/uploads/new-private.txt" })).status).toBe(400);

    const response = await postChannel({
      attachmentUrl: "https://media.example.test/campfire.gif",
      attachmentName: "gif",
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      message: { attachmentUrl: "https://media.example.test/campfire.gif" },
    });
  });

  it("does not expose a pending upload to unrelated users", async () => {
    const upload = await pendingUpload(owner.id);
    signIn(outsider);
    expect((await postChannel({ attachmentId: upload.id })).status).toBe(403);
  });
});
