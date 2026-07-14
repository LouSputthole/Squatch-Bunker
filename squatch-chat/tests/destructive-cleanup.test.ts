import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { DELETE as deleteChannel } from "@/app/api/channels/[channelId]/route";
import { DELETE as deleteServer } from "@/app/api/servers/[serverId]/route";

async function createCamp(name: string) {
  const suffix = randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `${name}-${suffix}@t.local`,
      username: `${name}_${suffix}`,
      passwordHash: "x",
    },
  });
  const server = await prisma.server.create({
    data: { name, ownerId: owner.id },
  });
  await prisma.serverMember.create({
    data: { serverId: server.id, userId: owner.id, role: "owner" },
  });
  const channel = await prisma.channel.create({
    data: { serverId: server.id, name: `${name}-channel`, type: "text" },
  });
  authMock.getSession.mockResolvedValue({
    userId: owner.id,
    username: owner.username,
  });
  return { owner, server, channel };
}

async function createUpload() {
  const mediaRoot = await mkdtemp(join(tmpdir(), "campfire-delete-"));
  const uploads = join(mediaRoot, "uploads");
  await mkdir(uploads, { recursive: true });
  const fileName = `${randomUUID()}.txt`;
  const filePath = join(uploads, fileName);
  await writeFile(filePath, "delete me");
  return { mediaRoot, filePath, publicUrl: `/uploads/${fileName}` };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("destructive route cleanup", () => {
  it("removes an unreferenced local upload when its channel is deleted", async () => {
    const { owner, channel } = await createCamp("channel-delete");
    const upload = await createUpload();
    await prisma.message.create({
      data: {
        channelId: channel.id,
        authorId: owner.id,
        content: "temporary channel attachment",
        attachmentUrl: upload.publicUrl,
      },
    });

    const previousRoot = process.env.CAMPFIRE_UPLOAD_DIR;
    process.env.CAMPFIRE_UPLOAD_DIR = upload.mediaRoot;
    try {
      const response = await deleteChannel(
        new NextRequest(`http://test.local/api/channels/${channel.id}`, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ channelId: channel.id }) },
      );
      expect(response.status).toBe(200);
      await expect(access(upload.filePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
      else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
      await rm(upload.mediaRoot, { recursive: true, force: true });
    }
  });

  it("deletes feature records and uploads with their server", async () => {
    const { owner, server, channel } = await createCamp("server-delete");
    const upload = await createUpload();
    const message = await prisma.message.create({
      data: {
        channelId: channel.id,
        authorId: owner.id,
        content: "temporary camp attachment",
        attachmentUrl: upload.publicUrl,
      },
    });
    await Promise.all([
      prisma.journalEntry.create({
        data: {
          serverId: server.id,
          authorId: owner.id,
          sourceMessageId: message.id,
          content: message.content,
          attachmentUrl: upload.publicUrl,
        },
      }),
      prisma.sound.create({
        data: {
          serverId: server.id,
          name: "farewell",
          dataUrl: "data:audio/wav;base64,AA==",
          createdBy: owner.id,
        },
      }),
      prisma.role.create({
        data: { serverId: server.id, name: "Trail guide" },
      }),
      prisma.gathering.create({
        data: {
          serverId: server.id,
          channelId: channel.id,
          creatorId: owner.id,
          title: "Last gathering",
          startsAt: new Date(Date.now() + 60_000),
        },
      }),
    ]);

    const previousRoot = process.env.CAMPFIRE_UPLOAD_DIR;
    process.env.CAMPFIRE_UPLOAD_DIR = upload.mediaRoot;
    try {
      const response = await deleteServer(
        new Request(`http://test.local/api/servers/${server.id}`, {
          method: "DELETE",
        }),
        { params: Promise.resolve({ serverId: server.id }) },
      );
      expect(response.status).toBe(200);
      await expect(
        prisma.server.findUnique({ where: { id: server.id } }),
      ).resolves.toBeNull();
      await expect(access(upload.filePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
      else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
      await rm(upload.mediaRoot, { recursive: true, force: true });
    }
  });
});
