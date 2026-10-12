import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createToken, hashPassword, validateSessionToken } from "@/lib/auth";
import { sweepExpiredGuests } from "@/lib/guestCleanup";

const sessionMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getSession: sessionMock.getSession,
}));

import { DELETE as deleteMe, GET as me } from "@/app/api/auth/me/route";
import { PATCH as patchProfile } from "@/app/api/users/[userId]/route";

// Settings -> Account -> Delete account: DELETE /api/auth/me (lib/accountDeletion.ts).

const tag = Math.random().toString(36).slice(2, 8);
const PASSWORD = "correct horse battery";

type TestUser = { id: string; username: string };

async function passwordUser(label: string): Promise<TestUser> {
  return prisma.user.create({
    data: { email: `${label}-${tag}@deletion.test`, username: `${label}_${tag}`, passwordHash: await hashPassword(PASSWORD) },
  });
}

function oauthUser(label: string): Promise<TestUser> {
  return prisma.user.create({
    data: { email: `${label}-${tag}@deletion.test`, username: `${label}_${tag}`, passwordHash: `oauth_${crypto.randomUUID()}` },
  });
}

function requestDeletion(user: TestUser, body: Record<string, unknown>) {
  sessionMock.getSession.mockResolvedValue({ userId: user.id, username: user.username });
  return deleteMe(new Request("http://test.local/api/auth/me", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

async function camp(owner: TestUser, members: TestUser[] = []) {
  const server = await prisma.server.create({
    data: {
      name: `Camp ${owner.username}`,
      ownerId: owner.id,
      members: {
        create: [{ userId: owner.id, role: "owner" }, ...members.map((member) => ({ userId: member.id }))],
      },
    },
  });
  const channel = await prisma.channel.create({ data: { serverId: server.id, name: "general" } });
  return { server, channel };
}

/** Point public media (/avatars, /uploads) at a throwaway folder for one test. */
async function withMediaRoot(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "campfire-deletion-"));
  await mkdir(join(root, "avatars"));
  await mkdir(join(root, "uploads"));
  const previous = process.env.CAMPFIRE_UPLOAD_DIR;
  process.env.CAMPFIRE_UPLOAD_DIR = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.CAMPFIRE_UPLOAD_DIR;
    else process.env.CAMPFIRE_UPLOAD_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

afterEach(() => {
  sessionMock.getSession.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("DELETE /api/auth/me", () => {
  it("refuses while the user still owns a camp", async () => {
    const owner = await passwordUser("owner");
    const { server } = await camp(owner);

    const response = await requestDeletion(owner, { username: owner.username, password: PASSWORD });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain(server.name);
    expect(await prisma.user.findUnique({ where: { id: owner.id } })).toMatchObject({ email: `owner-${tag}@deletion.test` });
    expect(await prisma.serverMember.count({ where: { userId: owner.id } })).toBe(1);
  });

  it("rejects a wrong username or a wrong or missing password and changes nothing", async () => {
    const careful = await passwordUser("careful");

    expect((await requestDeletion(careful, { username: "someone-else", password: PASSWORD })).status).toBe(400);
    expect((await requestDeletion(careful, { username: careful.username, password: "not it" })).status).toBe(403);
    expect((await requestDeletion(careful, { username: careful.username })).status).toBe(403);

    const after = await prisma.user.findUnique({ where: { id: careful.id } });
    expect(after).toMatchObject({ username: careful.username, isGuest: false, tokenVersion: 0 });
  });

  it("deletes an account that left nothing behind, with its private data, and revokes its sessions", async () => {
    const leaver = await passwordUser("leaver");
    const host = await passwordUser("host");
    const { server, channel } = await camp(host, [leaver]);
    const hostMessage = await prisma.message.create({ data: { channelId: channel.id, authorId: host.id, content: "welcome in" } });
    const joinNotice = await prisma.message.create({
      data: { channelId: channel.id, authorId: leaver.id, content: `${leaver.username} joined the server`, isSystem: true },
    });
    await prisma.reaction.create({ data: { messageId: hostMessage.id, userId: leaver.id, emoji: "🔥" } });
    await prisma.bookmark.create({ data: { messageId: hostMessage.id, userId: leaver.id } });
    await prisma.friendship.create({ data: { requesterId: leaver.id, addresseeId: host.id, status: "accepted" } });
    await prisma.userNote.create({ data: { authorId: leaver.id, targetUserId: host.id, content: "met at the lake" } });
    await prisma.journalEntry.create({ data: { serverId: server.id, authorId: leaver.id, sourceMessageId: hostMessage.id, content: "welcome in" } });
    await prisma.notification.create({ data: { userId: leaver.id, type: "mention", title: "hi", body: "welcome in" } });
    // A notice in someone else's inbox that spells out the leaver's name.
    const theirNotice = await prisma.notification.create({
      data: { userId: host.id, actorId: leaver.id, type: "friend_request", title: `${leaver.username} sent you a friend request`, body: "" },
    });
    await prisma.notificationPreference.create({ data: { userId: leaver.id, serverId: server.id, level: "mentions" } });
    await prisma.oAuthAccount.create({ data: { userId: leaver.id, provider: "github", providerAccountId: `gh-${tag}` } });
    await prisma.report.create({
      data: { reporterId: leaver.id, targetUserId: host.id, reason: "testing the report path", status: "dismissed" },
    });
    const upload = await prisma.privateUpload.create({
      data: { ownerId: leaver.id, storageKey: `${crypto.randomUUID()}.txt`, originalName: "notes.txt", contentType: "text/plain", byteSize: 5 },
    });
    const token = createToken({ userId: leaver.id, username: leaver.username, tokenVersion: 0 });
    expect(await validateSessionToken(token)).not.toBeNull();

    const response = await requestDeletion(leaver, { username: ` ${leaver.username} `, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
    expect(await prisma.user.findUnique({ where: { id: leaver.id } })).toBeNull();
    expect(await validateSessionToken(token)).toBeNull();
    expect(await prisma.message.findUnique({ where: { id: joinNotice.id } })).toBeNull();
    expect(await prisma.serverMember.count({ where: { userId: leaver.id } })).toBe(0);
    expect(await prisma.reaction.count({ where: { userId: leaver.id } })).toBe(0);
    expect(await prisma.bookmark.count({ where: { userId: leaver.id } })).toBe(0);
    expect(await prisma.friendship.count({ where: { OR: [{ requesterId: leaver.id }, { addresseeId: leaver.id }] } })).toBe(0);
    expect(await prisma.userNote.count({ where: { authorId: leaver.id } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { authorId: leaver.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: leaver.id } })).toBe(0);
    expect(await prisma.notification.findUnique({ where: { id: theirNotice.id } })).toBeNull();
    expect(await prisma.oAuthAccount.count({ where: { userId: leaver.id } })).toBe(0);
    expect(await prisma.report.count({ where: { reporterId: leaver.id } })).toBe(0);
    expect(await prisma.privateUpload.findUnique({ where: { id: upload.id } })).toBeNull();

    // The other person's camp, message, and membership are untouched.
    expect(await prisma.user.findUnique({ where: { id: host.id } })).not.toBeNull();
    expect(await prisma.message.findUnique({ where: { id: hostMessage.id } })).toMatchObject({ content: "welcome in" });
    expect(await prisma.serverMember.count({ where: { serverId: server.id, userId: host.id } })).toBe(1);
  });

  it("keeps what others rely on under a Deleted user placeholder, which the guest sweep finishes", async () => {
    const talker = await passwordUser("talker");
    const listener = await passwordUser("listener");
    const { server, channel } = await camp(listener, [talker]);
    const post = await prisma.message.create({ data: { channelId: channel.id, authorId: talker.id, content: "see you at the fire" } });
    const conversation = await prisma.conversation.create({ data: { user1Id: talker.id, user2Id: listener.id } });
    const sent = await prisma.directMessage.create({ data: { conversationId: conversation.id, authorId: talker.id, content: "hey" } });
    const received = await prisma.directMessage.create({ data: { conversationId: conversation.id, authorId: listener.id, content: "hi!" } });
    await prisma.friendship.create({ data: { requesterId: talker.id, addresseeId: listener.id, status: "accepted" } });
    const token = createToken({ userId: talker.id, username: talker.username, tokenVersion: 0 });

    const response = await requestDeletion(talker, { username: talker.username, password: PASSWORD });

    expect(response.status).toBe(200);
    const placeholder = await prisma.user.findUnique({ where: { id: talker.id } });
    expect(placeholder).toMatchObject({
      email: `deleted-${talker.id}@campfire.local`,
      isGuest: true,
      avatar: null,
      bio: null,
      tokenVersion: 1,
    });
    expect(placeholder?.username).toMatch(/^Deleted user#[0-9a-f]{12}$/);
    expect(await validateSessionToken(token)).toBeNull();
    expect(await prisma.serverMember.count({ where: { userId: talker.id } })).toBe(0);
    expect(await prisma.friendship.count({ where: { requesterId: talker.id } })).toBe(0);
    // Their words stay in other people's history; the listener's side is untouched.
    expect(await prisma.message.findUnique({ where: { id: post.id } })).toMatchObject({ authorId: talker.id });
    expect(await prisma.directMessage.count({ where: { id: { in: [sent.id, received.id] } } })).toBe(2);
    expect(await prisma.serverMember.count({ where: { serverId: server.id, userId: listener.id } })).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: listener.id } })).toMatchObject({ username: listener.username });

    // Once that content is gone, the hourly guest sweep deletes the placeholder.
    await prisma.message.delete({ where: { id: post.id } });
    await prisma.directMessage.deleteMany({ where: { conversationId: conversation.id } });
    await sweepExpiredGuests(new Date());
    expect(await prisma.user.findUnique({ where: { id: talker.id } })).toBeNull();
    expect(await prisma.conversation.findUnique({ where: { id: conversation.id } })).toBeNull();
  });

  it("needs no password for GitHub/Google-only accounts and drops a DM thread once both sides are deleted", async () => {
    const first = await oauthUser("first");
    const second = await oauthUser("second");
    const conversation = await prisma.conversation.create({ data: { user1Id: first.id, user2Id: second.id } });
    await prisma.directMessage.create({ data: { conversationId: conversation.id, authorId: first.id, content: "ping" } });
    await prisma.directMessage.create({ data: { conversationId: conversation.id, authorId: second.id, content: "pong" } });

    expect((await requestDeletion(first, { username: first.username })).status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: first.id } })).not.toBeNull();

    expect((await requestDeletion(second, { username: second.username })).status).toBe(200);
    expect(await prisma.conversation.findUnique({ where: { id: conversation.id } })).toBeNull();
    expect(await prisma.directMessage.count({ where: { conversationId: conversation.id } })).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: second.id } })).toBeNull();

    await sweepExpiredGuests(new Date());
    expect(await prisma.user.findUnique({ where: { id: first.id } })).toBeNull();
  });

  it("lets a guest leave with just their name", async () => {
    const guest = await prisma.user.create({
      data: {
        email: `guest-del-${tag}@campfire.local`,
        username: `Sam#${tag}`,
        passwordHash: "x",
        isGuest: true,
        guestExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    expect((await requestDeletion(guest, { username: guest.username })).status).toBe(200);
    expect(await prisma.user.findUnique({ where: { id: guest.id } })).toBeNull();
  });

  it("removes the uploaded avatar and banner files", async () => {
    await withMediaRoot(async (root) => {
      const pictured = await passwordUser("pictured");
      const avatarFile = join(root, "avatars", `${pictured.id}.png`);
      const bannerName = `${randomBytes(8).toString("hex")}.png`;
      const bannerFile = join(root, "uploads", bannerName);
      await writeFile(avatarFile, "avatar");
      await writeFile(bannerFile, "banner");
      await prisma.user.update({
        where: { id: pictured.id },
        data: { avatar: `/avatars/${pictured.id}.png`, banner: `/uploads/${bannerName}` },
      });

      expect((await requestDeletion(pictured, { username: pictured.username, password: PASSWORD })).status).toBe(200);
      expect(await prisma.user.findUnique({ where: { id: pictured.id } })).toBeNull();
      expect(existsSync(avatarFile)).toBe(false);
      expect(existsSync(bannerFile)).toBe(false);
    });
  });

  it("keeps an open report the user filed, under the placeholder, until it is handled", async () => {
    const witness = await passwordUser("witness");
    const accused = await passwordUser("accused");
    const report = await prisma.report.create({
      data: { reporterId: witness.id, targetUserId: accused.id, reason: "still being looked at" },
    });

    expect((await requestDeletion(witness, { username: witness.username, password: PASSWORD })).status).toBe(200);
    expect(await prisma.report.findUnique({ where: { id: report.id } })).toMatchObject({ reporterId: witness.id, status: "open" });
    expect((await prisma.user.findUnique({ where: { id: witness.id } }))?.username).toMatch(/^Deleted user#/);

    await prisma.report.update({ where: { id: report.id }, data: { status: "resolved" } });
    await sweepExpiredGuests(new Date());
    expect(await prisma.user.findUnique({ where: { id: witness.id } })).toBeNull();
    expect(await prisma.report.findUnique({ where: { id: report.id } })).toBeNull();
  });

  it("still reports success when tidying up after the committed deletion fails", async () => {
    const unlucky = await passwordUser("unlucky");
    const failure = vi.spyOn(prisma.privateUpload, "findMany").mockRejectedValueOnce(new Error("db blip"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await requestDeletion(unlucky, { username: unlucky.username, password: PASSWORD });
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/);
      expect(failure).toHaveBeenCalled();
    } finally {
      failure.mockRestore();
      quiet.mockRestore();
    }
    expect(await prisma.user.findUnique({ where: { id: unlucky.id } })).toMatchObject({ isGuest: true, tokenVersion: 1 });

    // The hourly sweep finishes the job.
    await sweepExpiredGuests(new Date());
    expect(await prisma.user.findUnique({ where: { id: unlucky.id } })).toBeNull();
  });

  it("rate-limits attempts per account", async () => {
    const guesser = await oauthUser("guesser");
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await requestDeletion(guesser, { username: "wrong" })).status).toBe(400);
    }
    expect((await requestDeletion(guesser, { username: guesser.username })).status).toBe(429);
    expect(await prisma.user.findUnique({ where: { id: guesser.id } })).toMatchObject({ isGuest: false });
  });
});

describe("PATCH /api/users/:userId banner", () => {
  function saveProfile(user: TestUser, body: Record<string, unknown>) {
    sessionMock.getSession.mockResolvedValue({ userId: user.id, username: user.username });
    return patchProfile(
      new NextRequest(`http://test.local/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ userId: user.id }) },
    );
  }

  it("takes only an uploaded banner and removes the file it replaces", async () => {
    await withMediaRoot(async (root) => {
      const profiled = await passwordUser("profiled");
      const [oldName, newName] = [`${randomBytes(8).toString("hex")}.png`, `${randomBytes(8).toString("hex")}.png`];
      await writeFile(join(root, "uploads", oldName), "old");
      await writeFile(join(root, "uploads", newName), "new");
      await prisma.user.update({ where: { id: profiled.id }, data: { banner: `/uploads/${oldName}` } });

      expect((await saveProfile(profiled, { banner: "https://tracker.example/pixel.gif" })).status).toBe(400);
      expect((await saveProfile(profiled, { banner: "/avatars/someone.png" })).status).toBe(400);
      expect(existsSync(join(root, "uploads", oldName))).toBe(true);

      // Saving the bio resends the current banner unchanged.
      expect((await saveProfile(profiled, { bio: "hi", banner: `/uploads/${oldName}` })).status).toBe(200);
      expect(existsSync(join(root, "uploads", oldName))).toBe(true);

      expect((await saveProfile(profiled, { banner: `/uploads/${newName}` })).status).toBe(200);
      expect(existsSync(join(root, "uploads", oldName))).toBe(false);
      expect(existsSync(join(root, "uploads", newName))).toBe(true);

      expect((await saveProfile(profiled, { banner: "" })).status).toBe(200);
      expect(existsSync(join(root, "uploads", newName))).toBe(false);
      expect(await prisma.user.findUnique({ where: { id: profiled.id } })).toMatchObject({ banner: null, bio: "hi" });
    });
  });
});

describe("GET /api/auth/me", () => {
  it("says whether deleting asks for a password, never sending the hash", async () => {
    const withPassword = await passwordUser("haspw");
    const viaGitHub = await oauthUser("nopw");

    sessionMock.getSession.mockResolvedValue({ userId: withPassword.id, username: withPassword.username });
    const own = (await (await me()).json()).user;
    expect(own.hasPassword).toBe(true);
    expect(own).not.toHaveProperty("passwordHash");

    sessionMock.getSession.mockResolvedValue({ userId: viaGitHub.id, username: viaGitHub.username });
    expect((await (await me()).json()).user.hasPassword).toBe(false);
  });
});
