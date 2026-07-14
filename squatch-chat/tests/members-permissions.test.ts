import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET } from "@/app/api/servers/[serverId]/members/route";

let serverId: string;
let owner: { id: string; username: string };
let channelManager: { id: string; username: string };
let ordinaryMember: { id: string; username: string };
let bannedMember: { id: string; username: string };

beforeAll(async () => {
  owner = await prisma.user.create({
    data: {
      email: "members-permissions-owner@t.local",
      username: "members_permissions_owner",
      passwordHash: "x",
    },
  });
  channelManager = await prisma.user.create({
    data: {
      email: "members-permissions-manager@t.local",
      username: "members_permissions_manager",
      passwordHash: "x",
    },
  });
  ordinaryMember = await prisma.user.create({
    data: {
      email: "members-permissions-member@t.local",
      username: "members_permissions_member",
      passwordHash: "x",
    },
  });
  bannedMember = await prisma.user.create({
    data: {
      email: "members-permissions-banned@t.local",
      username: "members_permissions_banned",
      passwordHash: "x",
    },
  });

  const server = await prisma.server.create({
    data: { name: "Member permission flow", ownerId: owner.id },
  });
  serverId = server.id;
  const managerMembership = await prisma.serverMember.create({
    data: { serverId, userId: channelManager.id, role: "member" },
  });
  await prisma.serverMember.createMany({
    data: [
      { serverId, userId: owner.id, role: "owner" },
      { serverId, userId: ordinaryMember.id, role: "member" },
      {
        serverId,
        userId: bannedMember.id,
        role: "admin",
        banned: true,
        bannedAt: new Date(),
      },
    ],
  });
  const customRole = await prisma.role.create({
    data: {
      serverId,
      name: "Trail builder",
      permissions: JSON.stringify(["MANAGE_CHANNELS"]),
    },
  });
  await prisma.serverMemberRole.create({
    data: { memberId: managerMembership.id, roleId: customRole.id },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

function signIn(user: { id: string; username: string }) {
  authMock.getSession.mockResolvedValue({
    userId: user.id,
    username: user.username,
  });
}

function listMembers() {
  return GET(new Request("http://test.local/members"), {
    params: Promise.resolve({ serverId }),
  });
}

describe("members route effective permissions", () => {
  it("exposes MANAGE_CHANNELS from a custom role", async () => {
    signIn(channelManager);
    const response = await listMembers();
    expect(response.status).toBe(200);
    expect((await response.json()).currentUserPermissions).toContain(
      "MANAGE_CHANNELS",
    );
  });

  it("does not grant channel management to an ordinary member", async () => {
    signIn(ordinaryMember);
    const response = await listMembers();
    expect(response.status).toBe(200);
    expect((await response.json()).currentUserPermissions).not.toContain(
      "MANAGE_CHANNELS",
    );
  });

  it("hides banned-member records from callers without BAN_MEMBERS", async () => {
    signIn(ordinaryMember);
    const response = await listMembers();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.members.map((member: { id: string }) => member.id)).not.toContain(
      bannedMember.id,
    );
  });

  it("lets the owner view banned-member records", async () => {
    signIn(owner);
    const response = await listMembers();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.members.map((member: { id: string }) => member.id)).toContain(
      bannedMember.id,
    );
  });

  it("rejects a banned membership", async () => {
    signIn(bannedMember);
    expect((await listMembers()).status).toBe(403);
  });
});
