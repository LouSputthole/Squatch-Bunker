import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  privateAttachmentUrl,
  privateContentDisposition,
} from "@/lib/privateUploads";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import {
  GET as readAttachment,
  HEAD as headAttachment,
} from "@/app/api/attachments/[attachmentId]/route";
import { POST as saveJournalEntry } from "@/app/api/servers/[serverId]/journal/route";

interface TestUser {
  id: string;
  username: string;
}

let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let banned: TestUser;
let serverId: string;
let channelId: string;
let conversationId: string;
let mediaRoot: string;
let previousMediaRoot: string | undefined;

function signIn(user: TestUser) {
  authMock.getSession.mockResolvedValue({ userId: user.id, username: user.username });
}

function context(attachmentId: string) {
  return { params: Promise.resolve({ attachmentId }) };
}

function request(attachmentId: string, range?: string, method = "GET") {
  return new NextRequest(`http://test.local${privateAttachmentUrl(attachmentId)}`, {
    method,
    headers: range ? { range } : undefined,
  });
}

async function createStoredUpload(
  ownerId: string,
  content: string,
  claimKind: "channel-message" | "direct-message",
  claimId: string,
) {
  const storageKey = `${crypto.randomUUID()}.txt`;
  await writeFile(join(mediaRoot, "private-uploads", storageKey), content);
  return prisma.privateUpload.create({
    data: {
      ownerId,
      storageKey,
      originalName: "private-note.txt",
      contentType: "text/plain",
      byteSize: Buffer.byteLength(content),
      state: "claimed",
      claimKind,
      claimId,
      claimedAt: new Date(),
    },
  });
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [owner, member, outsider, banned] = await Promise.all(
    ["owner", "member", "outsider", "banned"].map((label) =>
      prisma.user.create({
        data: {
          email: `attachment-read-${label}-${suffix}@t.local`,
          username: `attachment_read_${label}_${suffix}`,
          passwordHash: "x",
        },
      }),
    ),
  );
  const server = await prisma.server.create({
    data: {
      name: "Private attachment reads",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: member.id, role: "member" },
          { userId: banned.id, role: "member", banned: true },
        ],
      },
      channels: { create: { name: "private-reads", type: "text" } },
    },
    include: { channels: true },
  });
  serverId = server.id;
  channelId = server.channels[0].id;
  conversationId = (await prisma.conversation.create({
    data: { user1Id: owner.id, user2Id: member.id },
  })).id;

  mediaRoot = await mkdtemp(join(tmpdir(), "campfire-private-read-"));
  await mkdir(join(mediaRoot, "private-uploads"), { recursive: true });
  previousMediaRoot = process.env.CAMPFIRE_UPLOAD_DIR;
  process.env.CAMPFIRE_UPLOAD_DIR = mediaRoot;
});

afterAll(async () => {
  if (previousMediaRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
  else process.env.CAMPFIRE_UPLOAD_DIR = previousMediaRoot;
  await rm(mediaRoot, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("private attachment reads", () => {
  it("serves full and single byte ranges to an authorized channel member", async () => {
    const messageId = crypto.randomUUID();
    const upload = await createStoredUpload(
      owner.id,
      "0123456789",
      "channel-message",
      messageId,
    );
    await prisma.message.create({
      data: {
        id: messageId,
        channelId,
        authorId: owner.id,
        content: "range probe",
        attachmentUrl: privateAttachmentUrl(upload.id),
        attachmentName: upload.originalName,
        privateUploadId: upload.id,
      },
    });
    signIn(member);

    const full = await readAttachment(request(upload.id), context(upload.id));
    expect(full.status).toBe(200);
    expect(await full.text()).toBe("0123456789");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(full.headers.get("cache-control")).toBe("private, no-store");

    for (const [range, body, contentRange] of [
      ["bytes=2-5", "2345", "bytes 2-5/10"],
      ["bytes=6-", "6789", "bytes 6-9/10"],
      ["bytes=-3", "789", "bytes 7-9/10"],
    ] as const) {
      const response = await readAttachment(request(upload.id, range), context(upload.id));
      expect(response.status).toBe(206);
      expect(await response.text()).toBe(body);
      expect(response.headers.get("content-range")).toBe(contentRange);
      expect(response.headers.get("content-length")).toBe(String(body.length));
    }

    for (const range of ["bytes=20-30", "bytes=1-2,4-5", "items=1-2"]) {
      const response = await readAttachment(request(upload.id, range), context(upload.id));
      expect(response.status).toBe(416);
      expect(response.headers.get("content-range")).toBe("bytes */10");
    }

    const head = await headAttachment(
      request(upload.id, "bytes=0-0", "HEAD"),
      context(upload.id),
    );
    expect(head.status).toBe(206);
    expect(head.headers.get("content-length")).toBe("1");
    expect(await head.text()).toBe("");
  });

  it("stops channel attachment reads after permission revocation or a ban", async () => {
    const messageId = crypto.randomUUID();
    const upload = await createStoredUpload(owner.id, "revoked", "channel-message", messageId);
    await prisma.message.create({
      data: {
        id: messageId,
        channelId,
        authorId: owner.id,
        content: "revocation probe",
        attachmentUrl: privateAttachmentUrl(upload.id),
        privateUploadId: upload.id,
      },
    });

    signIn(member);
    expect((await readAttachment(request(upload.id), context(upload.id))).status).toBe(200);
    await prisma.channelPermission.create({
      data: { channelId, role: "member", canView: false, canSend: false },
    });
    expect((await readAttachment(request(upload.id), context(upload.id))).status).toBe(404);

    signIn(banned);
    expect((await readAttachment(request(upload.id), context(upload.id))).status).toBe(404);
  });

  it("allows only direct-message participants to read a DM attachment", async () => {
    const directMessageId = crypto.randomUUID();
    const upload = await createStoredUpload(
      owner.id,
      "direct only",
      "direct-message",
      directMessageId,
    );
    await prisma.directMessage.create({
      data: {
        id: directMessageId,
        conversationId,
        authorId: owner.id,
        content: "",
        attachmentUrl: privateAttachmentUrl(upload.id),
        privateUploadId: upload.id,
      },
    });

    signIn(member);
    expect((await readAttachment(request(upload.id), context(upload.id))).status).toBe(200);
    signIn(outsider);
    expect((await readAttachment(request(upload.id), context(upload.id))).status).toBe(404);
  });

  it("keeps a journal owner's attachment readable after source deletion and channel revocation", async () => {
    const journalChannel = await prisma.channel.create({
      data: { serverId, name: `journal-${crypto.randomUUID()}`, type: "text" },
    });
    const messageId = crypto.randomUUID();
    const upload = await createStoredUpload(owner.id, "keepsake", "channel-message", messageId);
    await prisma.message.create({
      data: {
        id: messageId,
        channelId: journalChannel.id,
        authorId: owner.id,
        content: "keep this",
        attachmentUrl: privateAttachmentUrl(upload.id),
        attachmentName: upload.originalName,
        privateUploadId: upload.id,
      },
    });

    signIn(member);
    const saved = await saveJournalEntry(
      new Request(`http://test.local/api/servers/${serverId}/journal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId }),
      }),
      { params: Promise.resolve({ serverId }) },
    );
    expect(saved.status).toBe(201);
    await expect(saved.json()).resolves.toMatchObject({
      entry: { privateUploadId: upload.id },
    });

    await prisma.channelPermission.create({
      data: { channelId: journalChannel.id, role: "member", canView: false, canSend: false },
    });
    await prisma.message.delete({ where: { id: messageId } });
    expect((await readAttachment(request(upload.id), context(upload.id))).status).toBe(200);

    signIn(outsider);
    expect((await readAttachment(request(upload.id), context(upload.id))).status).toBe(404);
  });

  it("builds Content-Disposition safely for malformed Unicode filenames", () => {
    expect(() => privateContentDisposition("broken-\ud800-name.txt")).not.toThrow();
    expect(privateContentDisposition("broken-\ud800-name.txt")).toContain("filename*=");
  });
});
