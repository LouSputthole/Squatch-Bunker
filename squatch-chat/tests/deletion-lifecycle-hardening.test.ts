import { randomUUID } from "node:crypto";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import type { RealtimeAuthorizationChange } from "@/lib/realtimeControl";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  notifyRealtimeAuthorizationChange: vi.fn<
    (change: RealtimeAuthorizationChange) => Promise<void>
  >(),
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/realtimeControl", () => ({
  notifyRealtimeAuthorizationChange: mocks.notifyRealtimeAuthorizationChange,
}));

import { DELETE as deleteChannel } from "@/app/api/channels/[channelId]/route";
import {
  DELETE as deleteServer,
  PATCH as patchServer,
} from "@/app/api/servers/[serverId]/route";
import { DELETE as deleteMessage } from "@/app/api/messages/[messageId]/route";
import { DELETE as deleteEmoji } from "@/app/api/servers/[serverId]/emoji/route";

async function createCamp(label: string) {
  const suffix = randomUUID();
  const owner = await prisma.user.create({
    data: {
      email: `delete-notify-${label}-${suffix}@t.local`,
      username: `delete_notify_${label}_${suffix}`,
      passwordHash: "x",
    },
  });
  const server = await prisma.server.create({
    data: { name: `Delete notify ${label}`, ownerId: owner.id },
  });
  await prisma.serverMember.create({
    data: { serverId: server.id, userId: owner.id, role: "owner" },
  });
  const channel = await prisma.channel.create({
    data: { serverId: server.id, name: `delete-${label}`, type: "text" },
  });
  mocks.getSession.mockResolvedValue({
    userId: owner.id,
    username: owner.username,
  });
  return { owner, server, channel };
}

beforeEach(() => {
  mocks.notifyRealtimeAuthorizationChange.mockReset();
  mocks.notifyRealtimeAuthorizationChange.mockResolvedValue(undefined);
});

afterAll(async () => {
  await prisma.$disconnect();
});

it("notifies realtime after a channel deletion commits", async () => {
  const { channel } = await createCamp("channel");
  mocks.notifyRealtimeAuthorizationChange.mockImplementationOnce(async (change) => {
    expect(change).toEqual({ scope: "channel", channelId: channel.id });
    await expect(
      prisma.channel.findUnique({ where: { id: channel.id } }),
    ).resolves.toBeNull();
  });

  const response = await deleteChannel(
    new NextRequest(`http://test.local/api/channels/${channel.id}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ channelId: channel.id }) },
  );

  expect(response.status).toBe(200);
  expect(mocks.notifyRealtimeAuthorizationChange).toHaveBeenCalledTimes(1);
});

it("notifies deleted channels and the server after server deletion commits", async () => {
  const { server, channel } = await createCamp("server");
  const secondChannel = await prisma.channel.create({
    data: { serverId: server.id, name: "delete-server-second", type: "voice" },
  });
  mocks.notifyRealtimeAuthorizationChange.mockImplementation(async (change) => {
    if (change.scope === "channel") {
      await expect(
        prisma.channel.findUnique({ where: { id: change.channelId } }),
      ).resolves.toBeNull();
    } else if (change.scope === "server") {
      await expect(
        prisma.server.findUnique({ where: { id: change.serverId } }),
      ).resolves.toBeNull();
    }
  });

  const response = await deleteServer(
    new Request(`http://test.local/api/servers/${server.id}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ serverId: server.id }) },
  );

  expect(response.status).toBe(200);
  expect(mocks.notifyRealtimeAuthorizationChange).toHaveBeenCalledTimes(3);
  expect(mocks.notifyRealtimeAuthorizationChange).toHaveBeenCalledWith({
    scope: "channel",
    channelId: channel.id,
  });
  expect(mocks.notifyRealtimeAuthorizationChange).toHaveBeenCalledWith({
    scope: "channel",
    channelId: secondChannel.id,
  });
  expect(mocks.notifyRealtimeAuthorizationChange.mock.calls.at(-1)?.[0]).toEqual({
    scope: "server",
    serverId: server.id,
  });
});

async function createUpload() {
  const mediaRoot = await mkdtemp(join(tmpdir(), "campfire-server-delete-"));
  const uploads = join(mediaRoot, "uploads");
  await mkdir(uploads, { recursive: true });
  const fileName = `${randomUUID()}.txt`;
  const filePath = join(uploads, fileName);
  await writeFile(filePath, "delete journal-only media");
  return { mediaRoot, filePath, publicUrl: `/uploads/${fileName}` };
}

it("removes a journal-only local upload when its server is deleted", async () => {
  const { owner, server } = await createCamp("journal-only");
  const upload = await createUpload();
  await prisma.journalEntry.create({
    data: {
      serverId: server.id,
      authorId: owner.id,
      content: "journal survives its source message",
      attachmentUrl: upload.publicUrl,
    },
  });

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
    await expect(access(upload.filePath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
    else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
    await rm(upload.mediaRoot, { recursive: true, force: true });
  }
});

it("removes a server icon upload when its server is deleted", async () => {
  const { server } = await createCamp("server-icon");
  const upload = await createUpload();
  await prisma.server.update({
    where: { id: server.id },
    data: { icon: upload.publicUrl },
  });

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
    await expect(access(upload.filePath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
    else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
    await rm(upload.mediaRoot, { recursive: true, force: true });
  }
});

const additionalServerMediaCases: Array<[
  string,
  (serverId: string, ownerId: string, url: string) => Promise<unknown>,
]> = [
  ["server banner", async (serverId, _ownerId, url) => prisma.server.update({
    where: { id: serverId },
    data: { banner: url },
  })],
  ["custom emoji", async (serverId, ownerId, url) => prisma.customEmoji.create({
    data: {
      serverId,
      name: `delete_${randomUUID()}`,
      url,
      createdBy: ownerId,
    },
  })],
];

it.each(additionalServerMediaCases)("removes %s media with its server", async (_label, seed) => {
  const { owner, server } = await createCamp(`media-${randomUUID()}`);
  const upload = await createUpload();
  await seed(server.id, owner.id, upload.publicUrl);

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
    await expect(access(upload.filePath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
    else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
    await rm(upload.mediaRoot, { recursive: true, force: true });
  }
});

it("removes non-FK notification preferences with a deleted server", async () => {
  const { owner, server, channel } = await createCamp("preferences");
  const preference = await prisma.notificationPreference.create({
    data: {
      userId: owner.id,
      serverId: server.id,
      channelId: channel.id,
      level: "all",
    },
  });

  const response = await deleteServer(
    new Request(`http://test.local/api/servers/${server.id}`, {
      method: "DELETE",
    }),
    { params: Promise.resolve({ serverId: server.id }) },
  );

  expect(response.status).toBe(200);
  await expect(
    prisma.notificationPreference.findUnique({ where: { id: preference.id } }),
  ).resolves.toBeNull();
});

it("removes an unreferenced local upload when its message is deleted", async () => {
  const { owner, channel } = await createCamp("message-delete");
  const upload = await createUpload();
  const message = await prisma.message.create({
    data: {
      channelId: channel.id,
      authorId: owner.id,
      content: "delete this attachment",
      attachmentUrl: upload.publicUrl,
    },
  });

  const previousRoot = process.env.CAMPFIRE_UPLOAD_DIR;
  process.env.CAMPFIRE_UPLOAD_DIR = upload.mediaRoot;
  try {
    const response = await deleteMessage(
      new Request(`http://test.local/api/messages/${message.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ messageId: message.id }) },
    );

    expect(response.status).toBe(200);
    await expect(access(upload.filePath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
    else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
    await rm(upload.mediaRoot, { recursive: true, force: true });
  }
});

it("removes an unreferenced local upload when its custom emoji is deleted", async () => {
  const { owner, server } = await createCamp("emoji-delete");
  const upload = await createUpload();
  const emoji = await prisma.customEmoji.create({
    data: {
      serverId: server.id,
      name: `delete_${randomUUID()}`,
      url: upload.publicUrl,
      createdBy: owner.id,
    },
  });

  const previousRoot = process.env.CAMPFIRE_UPLOAD_DIR;
  process.env.CAMPFIRE_UPLOAD_DIR = upload.mediaRoot;
  try {
    const response = await deleteEmoji(
      new NextRequest(
        `http://test.local/api/servers/${server.id}/emoji?id=${emoji.id}`,
        { method: "DELETE" },
      ),
      { params: Promise.resolve({ serverId: server.id }) },
    );

    expect(response.status).toBe(200);
    await expect(access(upload.filePath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
    else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
    await rm(upload.mediaRoot, { recursive: true, force: true });
  }
});

it("removes an old server icon upload after it is cleared", async () => {
  const { server } = await createCamp("clear-icon");
  const upload = await createUpload();
  await prisma.server.update({
    where: { id: server.id },
    data: { icon: upload.publicUrl },
  });

  const previousRoot = process.env.CAMPFIRE_UPLOAD_DIR;
  process.env.CAMPFIRE_UPLOAD_DIR = upload.mediaRoot;
  try {
    const response = await patchServer(
      new Request(`http://test.local/api/servers/${server.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ icon: "" }),
      }),
      { params: Promise.resolve({ serverId: server.id }) },
    );

    expect(response.status).toBe(200);
    await expect(access(upload.filePath)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
    else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
    await rm(upload.mediaRoot, { recursive: true, force: true });
  }
});
