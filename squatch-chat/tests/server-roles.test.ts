import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getPermContext, memberHasPermission } from "@/lib/serverRoles";

let serverId: string;
let activeUserId: string;
let bannedUserId: string;

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: { email: "roles-owner@t.local", username: "roles_owner", passwordHash: "x" },
  });
  const active = await prisma.user.create({
    data: { email: "roles-active@t.local", username: "roles_active", passwordHash: "x" },
  });
  const banned = await prisma.user.create({
    data: { email: "roles-banned@t.local", username: "roles_banned", passwordHash: "x" },
  });
  activeUserId = active.id;
  bannedUserId = banned.id;

  const server = await prisma.server.create({
    data: { name: "Role policy", ownerId: owner.id },
  });
  serverId = server.id;

  await prisma.serverMember.create({
    data: { serverId, userId: active.id, role: "admin" },
  });
  const bannedMembership = await prisma.serverMember.create({
    data: { serverId, userId: banned.id, role: "admin", banned: true, bannedAt: new Date() },
  });
  const customRole = await prisma.role.create({
    data: {
      serverId,
      name: "Channel manager",
      permissions: JSON.stringify(["MANAGE_CHANNELS"]),
    },
  });
  await prisma.serverMemberRole.create({
    data: { memberId: bannedMembership.id, roleId: customRole.id },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("server permission context", () => {
  it("retains permissions for an active member", async () => {
    const context = await getPermContext(serverId, activeUserId);
    expect(context.isMember).toBe(true);
    expect(context.tier).toBe("admin");
    expect(await memberHasPermission(serverId, activeUserId, "MANAGE_CHANNELS")).toBe(true);
  });

  it("treats a banned membership as absent, including legacy and custom permissions", async () => {
    const context = await getPermContext(serverId, bannedUserId);
    expect(context).toEqual({
      isOwner: false,
      isMember: false,
      tier: undefined,
      rolePermissionJsons: [],
    });
    expect(await memberHasPermission(serverId, bannedUserId, "MANAGE_CHANNELS")).toBe(false);
  });
});
