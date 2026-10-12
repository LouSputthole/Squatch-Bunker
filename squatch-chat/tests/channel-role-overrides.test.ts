import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  customRoleOverrideKey,
  decideChannelAccess,
  projectVisibleServerChannels,
  resolveChannelAccess,
} from "@/lib/channelAccess";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET as getMessages } from "@/app/api/messages/route";
import {
  DELETE as deleteOverride,
  GET as getOverrides,
  PUT as putOverride,
} from "@/app/api/channels/[channelId]/permissions/route";

interface TestUser {
  id: string;
  username: string;
}

let owner: TestUser;
let vipMember: TestUser;
let plainMember: TestUser;
let bannedVip: TestUser;
let mutedMod: TestUser;
let stackedMember: TestUser;
let serverId: string;
let vipChannelId: string;
let announcementsChannelId: string;
let vipRoleId: string;
let lurkerRoleId: string;
let mutedRoleId: string;
let defaultRoleId: string;
let foreignRoleId: string;

function signIn(user: TestUser) {
  authMock.getSession.mockResolvedValue({ userId: user.id, username: user.username });
}

function channelParams(channelId: string) {
  return { params: Promise.resolve({ channelId }) };
}

function put(channelId: string, body: Record<string, unknown>) {
  return putOverride(
    new Request(`http://test.local/api/channels/${channelId}/permissions`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    channelParams(channelId),
  );
}

beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [owner, vipMember, plainMember, bannedVip, mutedMod, stackedMember] = await Promise.all(
    ["owner", "vip", "plain", "banned", "muted", "stacked"].map((label) =>
      prisma.user.create({
        data: {
          email: `role-override-${label}-${suffix}@t.local`,
          username: `role_override_${label}_${suffix}`,
          passwordHash: "x",
        },
      }),
    ),
  );

  const server = await prisma.server.create({
    data: { name: "Role override tests", ownerId: owner.id },
  });
  serverId = server.id;
  const [vipRole, lurkerRole, mutedRole, defaultRole] = await Promise.all([
    prisma.role.create({ data: { serverId, name: "VIP", position: 10 } }),
    prisma.role.create({ data: { serverId, name: "Lurker", position: 5 } }),
    prisma.role.create({ data: { serverId, name: "Muted", position: 1 } }),
    prisma.role.create({ data: { serverId, name: "Member", isDefault: true } }),
  ]);
  vipRoleId = vipRole.id;
  lurkerRoleId = lurkerRole.id;
  mutedRoleId = mutedRole.id;
  defaultRoleId = defaultRole.id;

  const otherServer = await prisma.server.create({
    data: { name: "Someone else's camp", ownerId: plainMember.id },
  });
  foreignRoleId = (await prisma.role.create({
    data: { serverId: otherServer.id, name: "Foreign" },
  })).id;

  const memberships = [
    { user: owner, role: "owner", banned: false, roles: [] as string[] },
    { user: vipMember, role: "member", banned: false, roles: [vipRoleId] },
    { user: plainMember, role: "member", banned: false, roles: [] },
    { user: bannedVip, role: "member", banned: true, roles: [vipRoleId] },
    { user: mutedMod, role: "mod", banned: false, roles: [mutedRoleId] },
    { user: stackedMember, role: "member", banned: false, roles: [lurkerRoleId, vipRoleId] },
  ];
  for (const membership of memberships) {
    await prisma.serverMember.create({
      data: {
        serverId,
        userId: membership.user.id,
        role: membership.role,
        banned: membership.banned,
        memberRoles: { create: membership.roles.map((roleId) => ({ roleId })) },
      },
    });
  }

  const [vip, announcements] = await Promise.all([
    prisma.channel.create({ data: { serverId, name: "vip-lounge", type: "text" } }),
    prisma.channel.create({ data: { serverId, name: "announcements", type: "text" } }),
  ]);
  vipChannelId = vip.id;
  announcementsChannelId = announcements.id;

  await prisma.channelPermission.createMany({
    data: [
      // Private channel: hidden from the member tier, opened for @VIP.
      { channelId: vipChannelId, role: "member", canView: false, canSend: false },
      { channelId: vipChannelId, role: "mod", canView: false, canSend: false },
      { channelId: vipChannelId, role: customRoleOverrideKey(vipRoleId), canView: true, canSend: true },
      { channelId: vipChannelId, role: customRoleOverrideKey(lurkerRoleId), canView: true, canSend: false },
      // Open channel where @Muted is read-only.
      { channelId: announcementsChannelId, role: customRoleOverrideKey(mutedRoleId), canView: true, canSend: false },
    ],
  });
  await prisma.message.create({
    data: { channelId: vipChannelId, authorId: owner.id, content: "VIPs only" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("decideChannelAccess", () => {
  it("keeps tier-only behaviour and lets the owner bypass every override", () => {
    const hidden = [{ role: "member", canView: false, canSend: true }];
    expect(decideChannelAccess({ tier: "member", heldRoleIds: [], overrides: hidden }))
      .toEqual({ canView: false, canSend: false });
    expect(decideChannelAccess({ tier: "member", heldRoleIds: [], overrides: [] }))
      .toEqual({ canView: true, canSend: true });
    expect(decideChannelAccess({
      tier: "owner",
      heldRoleIds: ["r1"],
      overrides: [{ role: customRoleOverrideKey("r1"), canView: false, canSend: false }],
    })).toEqual({ canView: true, canSend: true });
  });

  it("ignores overrides for roles the member does not hold", () => {
    expect(decideChannelAccess({
      tier: "member",
      heldRoleIds: [],
      overrides: [
        { role: "member", canView: false, canSend: false },
        { role: customRoleOverrideKey("r1"), canView: true, canSend: true },
      ],
    })).toEqual({ canView: false, canSend: false });
  });
});

describe("resolveChannelAccess with custom role overrides", () => {
  it("lets a member holding the role see and post in the channel", async () => {
    await expect(resolveChannelAccess(vipChannelId, vipMember.id)).resolves.toMatchObject({
      canView: true,
      canSend: true,
    });
  });

  it("keeps the channel hidden from a member without the role", async () => {
    await expect(resolveChannelAccess(vipChannelId, plainMember.id)).resolves.toMatchObject({
      canView: false,
      canSend: false,
    });
  });

  it("never grants a banned member access, even with the role", async () => {
    await expect(resolveChannelAccess(vipChannelId, bannedVip.id)).resolves.toBeNull();
  });

  it("applies the most permissive of several held role overrides", async () => {
    await expect(resolveChannelAccess(vipChannelId, stackedMember.id)).resolves.toMatchObject({
      canView: true,
      canSend: true,
    });
  });

  it("lets a role override restrict a tier that is otherwise open", async () => {
    await expect(resolveChannelAccess(announcementsChannelId, mutedMod.id)).resolves.toMatchObject({
      canView: true,
      canSend: false,
    });
    await expect(resolveChannelAccess(vipChannelId, mutedMod.id)).resolves.toMatchObject({
      canView: false,
    });
  });

  it("gives the owner full access", async () => {
    await expect(resolveChannelAccess(vipChannelId, owner.id)).resolves.toMatchObject({
      canView: true,
      canSend: true,
    });
  });

  it("projects channel lists with the same rule", async () => {
    const servers = await prisma.server.findMany({
      where: { id: serverId },
      include: { channels: true },
    });
    const visibleTo = async (user: TestUser) => {
      const [server] = await projectVisibleServerChannels(servers, user.id);
      return server?.channels.map((channel) => channel.id) ?? null;
    };
    expect(await visibleTo(vipMember)).toContain(vipChannelId);
    expect(await visibleTo(stackedMember)).toContain(vipChannelId);
    expect(await visibleTo(plainMember)).not.toContain(vipChannelId);
    expect(await visibleTo(plainMember)).toContain(announcementsChannelId);
    expect(await visibleTo(mutedMod)).not.toContain(vipChannelId);
    expect(await visibleTo(bannedVip)).toBeNull();
  });

  it("enforces the decision on message history", async () => {
    signIn(vipMember);
    expect((await getMessages(new Request(`http://test.local/api/messages?channelId=${vipChannelId}`))).status)
      .toBe(200);
    signIn(plainMember);
    expect((await getMessages(new Request(`http://test.local/api/messages?channelId=${vipChannelId}`))).status)
      .toBe(403);
    signIn(bannedVip);
    expect((await getMessages(new Request(`http://test.local/api/messages?channelId=${vipChannelId}`))).status)
      .toBe(403);
  });
});

describe("channel permission route with custom roles", () => {
  it("lists overridable roles (not the default role) with their override keys", async () => {
    signIn(owner);
    const response = await getOverrides(
      new NextRequest(`http://test.local/api/channels/${vipChannelId}/permissions`),
      channelParams(vipChannelId),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    const keys = data.roles.map((role: { key: string }) => role.key);
    expect(keys).toEqual(expect.arrayContaining([
      customRoleOverrideKey(vipRoleId),
      customRoleOverrideKey(lurkerRoleId),
    ]));
    expect(keys).not.toContain(customRoleOverrideKey(defaultRoleId));
    expect(data.permissions.map((row: { role: string }) => row.role))
      .toContain(customRoleOverrideKey(vipRoleId));
  });

  it("accepts an override for a role on this server", async () => {
    signIn(owner);
    const response = await put(announcementsChannelId, {
      role: customRoleOverrideKey(vipRoleId),
      canView: false,
      canSend: true,
    });
    expect(response.status).toBe(200);
    // A hidden override is stored as not-sendable.
    await expect(response.json()).resolves.toMatchObject({
      permission: { canView: false, canSend: false },
    });
    await expect(resolveChannelAccess(announcementsChannelId, vipMember.id)).resolves.toMatchObject({
      canView: false,
    });

    const removed = await deleteOverride(
      new NextRequest(
        `http://test.local/api/channels/${announcementsChannelId}/permissions?role=${encodeURIComponent(customRoleOverrideKey(vipRoleId))}`,
        { method: "DELETE" },
      ),
      channelParams(announcementsChannelId),
    );
    expect(removed.status).toBe(200);
    await expect(resolveChannelAccess(announcementsChannelId, vipMember.id)).resolves.toMatchObject({
      canView: true,
      canSend: true,
    });
  });

  it("rejects roles from another server, the default role, and unknown keys", async () => {
    signIn(owner);
    for (const role of [
      customRoleOverrideKey(foreignRoleId),
      customRoleOverrideKey(defaultRoleId),
      customRoleOverrideKey("does-not-exist"),
      "role:",
      "owner",
      "superadmin",
    ]) {
      expect((await put(vipChannelId, { role, canView: true, canSend: true })).status).toBe(400);
    }
    await expect(prisma.channelPermission.count({
      where: { channelId: vipChannelId, role: customRoleOverrideKey(foreignRoleId) },
    })).resolves.toBe(0);
  });

  it("rejects non-boolean flags and callers without Manage Channels", async () => {
    signIn(owner);
    expect((await put(vipChannelId, { role: "member", canView: "yes" })).status).toBe(400);

    signIn(vipMember);
    expect((await put(vipChannelId, { role: customRoleOverrideKey(vipRoleId), canView: true })).status)
      .toBe(403);
    const removed = await deleteOverride(
      new NextRequest(
        `http://test.local/api/channels/${vipChannelId}/permissions?role=member`,
        { method: "DELETE" },
      ),
      channelParams(vipChannelId),
    );
    expect(removed.status).toBe(403);
  });
});
