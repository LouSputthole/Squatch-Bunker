import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  removePrivateUploadsForOwnerDeletion,
  sweepAbandonedPrivateUploads,
  sweepExpiredMessages,
} from "@/lib/messageRetention";
import { privateAttachmentUrl } from "@/lib/privateUploads";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  notifyRealtimeAuthorizationChange: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/realtimeControl", () => ({
  notifyRealtimeAuthorizationChange: mocks.notifyRealtimeAuthorizationChange,
}));

import { DELETE as deleteMessage } from "@/app/api/messages/[messageId]/route";
import { DELETE as deleteChannel } from "@/app/api/channels/[channelId]/route";
import { DELETE as deleteServer } from "@/app/api/servers/[serverId]/route";
import { DELETE as deleteJournalEntry } from "@/app/api/servers/[serverId]/journal/route";
import { POST as purgeMessages } from "@/app/api/messages/purge/route";

let mediaRoot: string;
let previousMediaRoot: string | undefined;

async function createCamp(label: string, retentionDays?: number) {
  const suffix = crypto.randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `private-cleanup-${label}-${suffix}@t.local`,
      username: `private_cleanup_${label}_${suffix}`,
      passwordHash: "x",
    },
  });
  const server = await prisma.server.create({
    data: {
      name: `Private cleanup ${label}`,
      ownerId: owner.id,
      members: { create: { userId: owner.id, role: "owner" } },
      channels: {
        create: {
          name: `cleanup-${label}`,
          type: "text",
          ...(retentionDays ? { retentionDays } : {}),
        },
      },
    },
    include: { channels: true },
  });
  mocks.getSession.mockResolvedValue({ userId: owner.id, username: owner.username });
  return { owner, server, channel: server.channels[0] };
}

async function createMessageAttachment(
  camp: Awaited<ReturnType<typeof createCamp>>,
  createdAt = new Date(),
) {
  const messageId = crypto.randomUUID();
  const storageKey = `${crypto.randomUUID()}.txt`;
  const filePath = join(mediaRoot, "private-uploads", storageKey);
  await writeFile(filePath, "delete me");
  const upload = await prisma.privateUpload.create({
    data: {
      ownerId: camp.owner.id,
      storageKey,
      originalName: "delete-me.txt",
      contentType: "text/plain",
      byteSize: 9,
      state: "claimed",
      claimKind: "channel-message",
      claimId: messageId,
      claimedAt: createdAt,
      createdAt,
    },
  });
  const message = await prisma.message.create({
    data: {
      id: messageId,
      channelId: camp.channel.id,
      authorId: camp.owner.id,
      content: "private cleanup probe",
      attachmentUrl: privateAttachmentUrl(upload.id),
      attachmentName: upload.originalName,
      privateUploadId: upload.id,
      createdAt,
    },
  });
  return { upload, message, filePath };
}

async function expectRemoved(uploadId: string, filePath: string) {
  await expect(prisma.privateUpload.findUnique({ where: { id: uploadId } })).resolves.toBeNull();
  await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
}

beforeAll(async () => {
  mediaRoot = await mkdtemp(join(tmpdir(), "campfire-private-cleanup-"));
  await mkdir(join(mediaRoot, "private-uploads"), { recursive: true });
  previousMediaRoot = process.env.CAMPFIRE_UPLOAD_DIR;
  process.env.CAMPFIRE_UPLOAD_DIR = mediaRoot;
});

beforeEach(() => {
  mocks.notifyRealtimeAuthorizationChange.mockClear();
});

afterAll(async () => {
  if (previousMediaRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
  else process.env.CAMPFIRE_UPLOAD_DIR = previousMediaRoot;
  await rm(mediaRoot, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("private attachment cleanup", () => {
  it("removes the file and metadata when a message is deleted", async () => {
    const camp = await createCamp("message");
    const attachment = await createMessageAttachment(camp);
    const response = await deleteMessage(
      new Request(`http://test.local/api/messages/${attachment.message.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ messageId: attachment.message.id }) },
    );
    expect(response.status).toBe(200);
    await expectRemoved(attachment.upload.id, attachment.filePath);
  });

  it("preserves a journal keepsake until its last reference is deleted", async () => {
    const camp = await createCamp("journal-reference");
    const attachment = await createMessageAttachment(camp);
    const entry = await prisma.journalEntry.create({
      data: {
        serverId: camp.server.id,
        authorId: camp.owner.id,
        sourceMessageId: attachment.message.id,
        content: attachment.message.content,
        attachmentUrl: privateAttachmentUrl(attachment.upload.id),
        attachmentName: attachment.upload.originalName,
        privateUploadId: attachment.upload.id,
      },
    });

    const messageResponse = await deleteMessage(
      new Request(`http://test.local/api/messages/${attachment.message.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ messageId: attachment.message.id }) },
    );
    expect(messageResponse.status).toBe(200);
    await expect(
      prisma.privateUpload.findUnique({ where: { id: attachment.upload.id } }),
    ).resolves.not.toBeNull();
    await expect(access(attachment.filePath)).resolves.toBeUndefined();

    await expect(
      removePrivateUploadsForOwnerDeletion(camp.owner.id),
    ).resolves.toMatchObject({ deletedUploads: 0, retainedUploads: 1 });

    const journalResponse = await deleteJournalEntry(
      new Request(
        `http://test.local/api/servers/${camp.server.id}/journal?entryId=${entry.id}`,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ serverId: camp.server.id }) },
    );
    expect(journalResponse.status).toBe(200);
    await expectRemoved(attachment.upload.id, attachment.filePath);
  });

  it("removes private files through channel deletion", async () => {
    const camp = await createCamp("channel");
    const attachment = await createMessageAttachment(camp);
    const response = await deleteChannel(
      new NextRequest(`http://test.local/api/channels/${camp.channel.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ channelId: camp.channel.id }) },
    );
    expect(response.status).toBe(200);
    await expectRemoved(attachment.upload.id, attachment.filePath);
  });

  it("removes private files through server deletion", async () => {
    const camp = await createCamp("server");
    const attachment = await createMessageAttachment(camp);
    const response = await deleteServer(
      new Request(`http://test.local/api/servers/${camp.server.id}`, { method: "DELETE" }),
      { params: Promise.resolve({ serverId: camp.server.id }) },
    );
    expect(response.status).toBe(200);
    await expectRemoved(attachment.upload.id, attachment.filePath);
  });

  it("removes private files through message purge", async () => {
    const camp = await createCamp("purge");
    const attachment = await createMessageAttachment(camp);
    const response = await purgeMessages(new NextRequest("http://test.local/api/messages/purge", {
      method: "POST",
      body: JSON.stringify({ channelId: camp.channel.id, count: 1 }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(200);
    await expectRemoved(attachment.upload.id, attachment.filePath);
  });

  it("removes private files through retention expiry", async () => {
    const camp = await createCamp("retention", 1);
    const now = new Date("2026-07-14T12:00:00.000Z");
    const attachment = await createMessageAttachment(
      camp,
      new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
    );
    await sweepExpiredMessages(now);
    await expectRemoved(attachment.upload.id, attachment.filePath);
  });

  it("sweeps pending uploads older than 24 hours but preserves recent ones", async () => {
    const camp = await createCamp("pending");
    const now = new Date("2026-07-14T12:00:00.000Z");
    async function pending(ageHours: number) {
      const storageKey = `${crypto.randomUUID()}.txt`;
      const filePath = join(mediaRoot, "private-uploads", storageKey);
      await writeFile(filePath, "pending");
      const upload = await prisma.privateUpload.create({
        data: {
          ownerId: camp.owner.id,
          storageKey,
          originalName: "pending.txt",
          contentType: "text/plain",
          byteSize: 7,
          createdAt: new Date(now.getTime() - ageHours * 60 * 60 * 1000),
        },
      });
      return { upload, filePath };
    }
    const stale = await pending(25);
    const recent = await pending(23);

    await expect(sweepAbandonedPrivateUploads(now)).resolves.toMatchObject({ deletedUploads: 1 });
    await expectRemoved(stale.upload.id, stale.filePath);
    await expect(access(recent.filePath)).resolves.toBeUndefined();
  });

  it("provides an explicit cleanup step before an upload owner is deleted", async () => {
    const camp = await createCamp("owner-delete");
    const storageKey = `${crypto.randomUUID()}.txt`;
    const filePath = join(mediaRoot, "private-uploads", storageKey);
    await writeFile(filePath, "owner pending");
    const upload = await prisma.privateUpload.create({
      data: {
        ownerId: camp.owner.id,
        storageKey,
        originalName: "owner.txt",
        contentType: "text/plain",
        byteSize: 13,
      },
    });

    await removePrivateUploadsForOwnerDeletion(camp.owner.id);
    await expectRemoved(upload.id, filePath);
  });
});
