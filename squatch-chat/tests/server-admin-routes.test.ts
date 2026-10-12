import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ensureDefaultRoles, memberHasPermission } from "@/lib/serverRoles";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { POST as createServer } from "@/app/api/servers/route";
import { PATCH as patchServer } from "@/app/api/servers/[serverId]/route";
import {
  DELETE as kickMember,
  PATCH as changeRole,
  PUT as setBan,
} from "@/app/api/servers/[serverId]/members/[userId]/route";
import { POST as createChannel } from "@/app/api/channels/route";
import {
  DELETE as deleteChannel,
  PATCH as patchChannel,
} from "@/app/api/channels/[channelId]/route";
import { POST as joinServer } from "@/app/api/servers/join/route";
import { POST as uploadSound } from "@/app/api/servers/[serverId]/sounds/route";

interface TestUser {
  id: string;
  username: string;
}

let owner: TestUser;
let target: TestUser;
let serverId: string;

function signIn(user: TestUser) {
  authMock.getSession.mockResolvedValue({ userId: user.id, username: user.username });
}

function json(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function makeUser(label: string): Promise<TestUser> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const user = await prisma.user.create({
    data: { email: `admin-${label}-${suffix}@t.local`, username: `admin_${label}_${suffix}`, passwordHash: "x" },
  });
  return { id: user.id, username: user.username };
}

async function auditActions() {
  const rows = await prisma.auditLog.findMany({ where: { serverId }, select: { action: true } });
  return rows.map((row) => row.action);
}

function serverParams(id = serverId) {
  return { params: Promise.resolve({ serverId: id }) };
}

beforeAll(async () => {
  owner = await makeUser("owner");
  target = await makeUser("target");
  const server = await prisma.server.create({ data: { name: "Admin", ownerId: owner.id } });
  serverId = server.id;
  await prisma.serverMember.createMany({
    data: [
      { serverId, userId: owner.id, role: "owner" },
      { serverId, userId: target.id, role: "member" },
    ],
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("server settings", () => {
  it("persists description and isPublic, validating each", async () => {
    signIn(owner);
    const url = `http://test.local/api/servers/${serverId}`;
    const ok = await patchServer(
      json(url, "PATCH", { name: "  Admin Camp  ", description: "  A cozy spot  ", isPublic: true }),
      serverParams(),
    );
    expect(ok.status).toBe(200);
    await expect(prisma.server.findUniqueOrThrow({ where: { id: serverId } })).resolves.toMatchObject({
      name: "Admin Camp",
      description: "A cozy spot",
      isPublic: true,
    });

    for (const bad of [
      { description: "x".repeat(501) },
      { description: 42 },
      { isPublic: "yes" },
      { name: "   " },
      { name: "n".repeat(101) },
    ]) {
      expect((await patchServer(json(url, "PATCH", bad), serverParams())).status).toBe(400);
    }

    // Clearing the description stores null.
    await patchServer(json(url, "PATCH", { description: "" }), serverParams());
    await expect(prisma.server.findUniqueOrThrow({ where: { id: serverId } })).resolves.toMatchObject({
      description: null,
    });
    expect(await auditActions()).toContain("server_update");
  });

  it("caps the name on create", async () => {
    signIn(owner);
    const url = "http://test.local/api/servers";
    expect((await createServer(json(url, "POST", { name: "n".repeat(101) }))).status).toBe(400);
    expect((await createServer(json(url, "POST", { name: 7 }))).status).toBe(400);
    const created = await createServer(json(url, "POST", { name: "  Fresh Camp " }));
    expect(created.status).toBe(201);
    expect((await created.json()).server.name).toBe("Fresh Camp");
  });
});

describe("member moderation", () => {
  it("audits role changes, bans, and unbans, and refuses to kick away a ban", async () => {
    signIn(owner);
    const url = `http://test.local/api/servers/${serverId}/members/${target.id}`;
    const params = { params: Promise.resolve({ serverId, userId: target.id }) };

    expect((await changeRole(json(url, "PATCH", { role: "mod" }), params)).status).toBe(200);
    expect((await setBan(json(url, "PUT", { banned: "true" }), params)).status).toBe(400);
    expect((await setBan(json(url, "PUT", { banned: true }), params)).status).toBe(200);

    const kickWhileBanned = await kickMember(json(url, "DELETE", {}), params);
    expect(kickWhileBanned.status).toBe(409);
    await expect(
      prisma.serverMember.findUniqueOrThrow({ where: { serverId_userId: { serverId, userId: target.id } } }),
    ).resolves.toMatchObject({ banned: true });

    expect((await setBan(json(url, "PUT", { banned: false }), params)).status).toBe(200);
    expect((await kickMember(json(url, "DELETE", {}), params)).status).toBe(200);
    expect(
      await prisma.serverMember.findUnique({ where: { serverId_userId: { serverId, userId: target.id } } }),
    ).toBeNull();

    const targetRows = await prisma.auditLog.findMany({
      where: { serverId, targetId: target.id },
      orderBy: { createdAt: "asc" },
      select: { action: true, actorId: true },
    });
    // Sorted: rows written within one millisecond share a createdAt.
    expect(targetRows.map((row) => row.action).sort()).toEqual([
      "member_ban",
      "member_kick",
      "member_role_change",
      "member_unban",
    ]);
    expect(targetRows.every((row) => row.actorId === owner.id)).toBe(true);
  });
});

describe("channels", () => {
  it("appends new channels, caps names, and audits create/update/delete", async () => {
    signIn(owner);
    const url = "http://test.local/api/channels";
    const first = await (await createChannel(json(url, "POST", { serverId, name: "First Light" }))).json();
    const second = await (await createChannel(json(url, "POST", { serverId, name: "second" }))).json();
    expect(first.channel.name).toBe("first-light");
    expect(second.channel.position).toBe(first.channel.position + 1);
    expect(second.channel.slowModeSeconds).toBe(0);
    expect((await createChannel(json(url, "POST", { serverId, name: "c".repeat(101) }))).status).toBe(400);

    const params = { params: Promise.resolve({ channelId: second.channel.id }) };
    const channelUrl = `${url}/${second.channel.id}`;
    const updated = await patchChannel(
      json(channelUrl, "PATCH", { slowModeSeconds: 30, description: " Quiet please " }),
      params,
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).channel).toMatchObject({ slowModeSeconds: 30, description: "Quiet please" });

    for (const bad of [
      { slowModeSeconds: 7 },
      { slowModeSeconds: "30" },
      { description: "d".repeat(201) },
      { name: "c".repeat(101) },
    ]) {
      expect((await patchChannel(json(channelUrl, "PATCH", bad), params)).status).toBe(400);
    }

    expect((await deleteChannel(json(channelUrl, "DELETE", {}), params)).status).toBe(200);
    const actions = await auditActions();
    expect(actions).toEqual(expect.arrayContaining(["channel_create", "channel_update", "channel_delete"]));
  });

  it("refuses slow-mode changes from members without Manage Channels", async () => {
    const outsider = await makeUser("member");
    await prisma.serverMember.create({ data: { serverId, userId: outsider.id } });
    const channel = await prisma.channel.create({ data: { serverId, name: "locked" } });
    signIn(outsider);
    const response = await patchChannel(
      json(`http://test.local/api/channels/${channel.id}`, "PATCH", { slowModeSeconds: 60 }),
      { params: Promise.resolve({ channelId: channel.id }) },
    );
    expect(response.status).toBe(403);
  });
});

describe("joining", () => {
  it("posts the configured welcome message after the join notice in the first visible text channel", async () => {
    const host = await makeUser("host");
    const joiner = await makeUser("joiner");
    const server = await prisma.server.create({
      data: { name: "Welcoming", ownerId: host.id, welcomeMessage: "  Read #rules and say hi!  " },
    });
    await prisma.serverMember.create({ data: { serverId: server.id, userId: host.id, role: "owner" } });
    const hidden = await prisma.channel.create({
      data: { serverId: server.id, name: "staff", position: 0 },
    });
    await prisma.channelPermission.create({
      data: { channelId: hidden.id, role: "member", canView: false, canSend: false },
    });
    const lobby = await prisma.channel.create({ data: { serverId: server.id, name: "lobby", position: 1 } });

    signIn(joiner);
    const response = await joinServer(
      json("http://test.local/api/servers/join", "POST", { inviteCode: server.inviteCode }),
    );
    expect(response.status).toBe(201);

    expect(await prisma.message.count({ where: { channelId: hidden.id } })).toBe(0);
    const posted = await prisma.message.findMany({
      where: { channelId: lobby.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { content: true, isSystem: true },
    });
    expect(posted).toEqual([
      { content: `${joiner.username} joined the server`, isSystem: true },
      { content: "Read #rules and say hi!", isSystem: true },
    ]);
  });
});

describe("soundboard", () => {
  it("caps clips per server", async () => {
    signIn(owner);
    await prisma.sound.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        serverId,
        name: `clip${i}`,
        dataUrl: "data:audio/ogg;base64,AA==",
        createdBy: owner.id,
      })),
    });
    const response = await uploadSound(
      json(`http://test.local/api/servers/${serverId}/sounds`, "POST", {
        name: "one too many",
        dataUrl: "data:audio/ogg;base64,AA==",
      }),
      serverParams(),
    );
    expect(response.status).toBe(409);
  });

  it("rate-limits one uploader", async () => {
    const host = await makeUser("dj");
    const server = await prisma.server.create({ data: { name: "Sounds", ownerId: host.id } });
    await prisma.serverMember.create({ data: { serverId: server.id, userId: host.id, role: "owner" } });
    signIn(host);
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) {
      const response = await uploadSound(
        json(`http://test.local/api/servers/${server.id}/sounds`, "POST", {
          name: `clip ${i}`,
          dataUrl: "data:audio/ogg;base64,AA==",
        }),
        serverParams(server.id),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe("default role", () => {
  it("grants its permissions to every active member, but not to banned ones", async () => {
    const host = await makeUser("roles-host");
    const plain = await makeUser("roles-plain");
    const banned = await makeUser("roles-banned");
    const server = await prisma.server.create({ data: { name: "Roles", ownerId: host.id } });
    await prisma.serverMember.createMany({
      data: [
        { serverId: server.id, userId: host.id, role: "owner" },
        { serverId: server.id, userId: plain.id },
        { serverId: server.id, userId: banned.id, banned: true, bannedAt: new Date() },
      ],
    });
    await ensureDefaultRoles(server.id);
    expect(await memberHasPermission(server.id, plain.id, "MANAGE_EMOJIS")).toBe(false);

    await prisma.role.updateMany({
      where: { serverId: server.id, isDefault: true },
      data: { permissions: JSON.stringify(["MANAGE_EMOJIS"]) },
    });
    expect(await memberHasPermission(server.id, plain.id, "MANAGE_EMOJIS")).toBe(true);
    expect(await memberHasPermission(server.id, banned.id, "MANAGE_EMOJIS")).toBe(false);
  });

  it("seeds exactly one set of default roles under concurrent first reads", async () => {
    const host = await makeUser("seed-host");
    const server = await prisma.server.create({ data: { name: "Seeds", ownerId: host.id } });
    await Promise.all(Array.from({ length: 5 }, () => ensureDefaultRoles(server.id)));
    const roles = await prisma.role.findMany({ where: { serverId: server.id } });
    expect(roles).toHaveLength(4);
    expect(roles.filter((role) => role.isDefault)).toHaveLength(1);
  });
});
