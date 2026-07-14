import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import {
  DELETE as deleteEntry,
  GET as listEntries,
  POST as saveEntry,
} from "@/app/api/servers/[serverId]/journal/route";

interface TestUser { id: string; username: string }
let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let serverId: string;
let channelId: string;
let hiddenChannelId: string;
let messageId: string;

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [owner, member, outsider] = await Promise.all(
    ["owner", "member", "outsider"].map((name) =>
      prisma.user.create({
        data: {
          email: `journal-${name}-${suffix}@t.local`,
          username: `journal_${name}_${suffix}`,
          passwordHash: "x",
        },
      }),
    ),
  );
  const server = await prisma.server.create({
    data: {
      name: "Journal Route Tests",
      ownerId: owner.id,
      members: { create: [{ userId: owner.id, role: "owner" }, { userId: member.id, role: "member" }] },
    },
  });
  serverId = server.id;
  channelId = (await prisma.channel.create({ data: { serverId, name: "keepsakes", type: "text" } })).id;
  hiddenChannelId = (await prisma.channel.create({
    data: {
      serverId,
      name: "hidden",
      type: "text",
      permissions: { create: { role: "member", canView: false, canSend: false } },
    },
  })).id;
  messageId = (await prisma.message.create({
    data: {
      channelId,
      authorId: owner.id,
      content: "A story worth keeping",
      attachmentUrl: "/uploads/story.txt",
      attachmentName: "story.txt",
    },
  })).id;
  await prisma.message.create({ data: { channelId: hiddenChannelId, authorId: owner.id, content: "secret" } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function signIn(user: TestUser | null) {
  authMock.getSession.mockResolvedValue(user ? { userId: user.id, username: user.username } : null);
}

function params() {
  return { params: Promise.resolve({ serverId }) };
}

function post(message: string, note?: string) {
  return saveEntry(new Request(`http://test.local/api/servers/${serverId}/journal`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId: message, note }),
  }), params());
}

describe("Camp Journal routes", () => {
  it("requires authentication and active server membership", async () => {
    signIn(null);
    expect((await listEntries(new Request("http://test.local"), params())).status).toBe(401);
    signIn(outsider);
    expect((await listEntries(new Request("http://test.local"), params())).status).toBe(403);
    expect((await post(messageId)).status).toBe(403);
  });

  it("stores a private immutable snapshot with attachment metadata", async () => {
    signIn(member);
    const response = await post(messageId, "For the next campout");
    expect(response.status).toBe(201);
    const { entry } = await response.json();
    expect(entry).toMatchObject({
      authorId: member.id,
      content: "A story worth keeping",
      attachmentUrl: "/uploads/story.txt",
      attachmentName: "story.txt",
      note: "For the next campout",
    });
    await prisma.message.update({ where: { id: messageId }, data: { content: "Edited later" } });
    expect(await prisma.journalEntry.findUnique({ where: { id: entry.id } })).toMatchObject({
      content: "A story worth keeping",
    });
  });

  it("lists only the caller's private entries", async () => {
    signIn(owner);
    const ownerSave = await post(messageId, "Owner copy");
    expect(ownerSave.status).toBe(201);
    const ownerEntries = (await (await listEntries(new Request("http://test.local"), params())).json()).entries;
    expect(ownerEntries.every((entry: { authorId: string }) => entry.authorId === owner.id)).toBe(true);
    signIn(member);
    const memberEntries = (await (await listEntries(new Request("http://test.local"), params())).json()).entries;
    expect(memberEntries.every((entry: { authorId: string }) => entry.authorId === member.id)).toBe(true);
  });

  it("honors hidden-channel visibility and server boundaries", async () => {
    const hiddenMessage = await prisma.message.findFirstOrThrow({ where: { channelId: hiddenChannelId } });
    signIn(member);
    expect((await post(hiddenMessage.id)).status).toBe(403);
    expect((await post(crypto.randomUUID())).status).toBe(404);
  });

  it("removes an upload when its final Journal reference is deleted", async () => {
    const mediaRoot = await mkdtemp(join(tmpdir(), "campfire-journal-"));
    const uploads = join(mediaRoot, "uploads");
    await mkdir(uploads, { recursive: true });
    const fileName = `journal-${crypto.randomUUID()}.txt`;
    const publicUrl = `/uploads/${fileName}`;
    const filePath = join(uploads, fileName);
    await writeFile(filePath, "private keepsake");

    const source = await prisma.message.create({
      data: {
        channelId,
        authorId: owner.id,
        content: "Temporary attachment",
        attachmentUrl: publicUrl,
      },
    });

    signIn(member);
    const saved = await post(source.id, "keep until removed");
    const { entry } = await saved.json();
    await prisma.message.delete({ where: { id: source.id } });

    const previousRoot = process.env.CAMPFIRE_UPLOAD_DIR;
    process.env.CAMPFIRE_UPLOAD_DIR = mediaRoot;
    try {
      const response = await deleteEntry(
        new Request(`http://test.local?entryId=${entry.id}`, { method: "DELETE" }),
        params(),
      );
      expect(response.status).toBe(200);
      await expect(access(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      if (previousRoot === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
      else process.env.CAMPFIRE_UPLOAD_DIR = previousRoot;
      await rm(mediaRoot, { recursive: true, force: true });
    }
  });

  it("only lets the author remove a Journal entry", async () => {
    signIn(member);
    const { entry } = await (await post(messageId, "remove me")).json();
    signIn(owner);
    expect((await deleteEntry(new Request(`http://test.local?entryId=${entry.id}`, { method: "DELETE" }), params())).status).toBe(404);
    signIn(member);
    expect((await deleteEntry(new Request(`http://test.local?entryId=${entry.id}`, { method: "DELETE" }), params())).status).toBe(200);
  });
});
