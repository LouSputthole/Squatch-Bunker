import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  notifyRealtimeAuthorizationChange: vi.fn(async () => undefined),
}));
vi.mock("@/lib/auth", () => ({ getSession: mocks.getSession }));
vi.mock("@/lib/realtimeControl", () => ({
  notifyRealtimeAuthorizationChange: mocks.notifyRealtimeAuthorizationChange,
}));

import {
  DELETE as kickMember,
  PATCH as changeLegacyRole,
  PUT as banMember,
} from "@/app/api/servers/[serverId]/members/[userId]/route";
import { PUT as assignCustomRoles } from "@/app/api/servers/[serverId]/members/[userId]/roles/route";
import { POST as createRole } from "@/app/api/servers/[serverId]/roles/route";
import {
  DELETE as deleteRole,
  PATCH as editRole,
} from "@/app/api/servers/[serverId]/roles/[roleId]/route";

interface TestUser {
  id: string;
  username: string;
}

let owner: TestUser;
let actor: TestUser;
let equalPeer: TestUser;
let adminTarget: TestUser;
let lowerRoleTarget: TestUser;
let lowerBanTarget: TestUser;
let lowerKickTarget: TestUser;
let serverId: string;
let actorRoleId: string;
let equalMemberRoleId: string;
let equalDefinitionRoleId: string;
let lowAssignableRoleId: string;
let editableBelowRoleId: string;

function signIn(user: TestUser) {
  mocks.getSession.mockResolvedValue({
    userId: user.id,
    username: user.username,
  });
}

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function memberParams(userId: string) {
  return { params: Promise.resolve({ serverId, userId }) };
}

function roleParams(roleId: string) {
  return { params: Promise.resolve({ serverId, roleId }) };
}

beforeAll(async () => {
  [
    owner,
    actor,
    equalPeer,
    adminTarget,
    lowerRoleTarget,
    lowerBanTarget,
    lowerKickTarget,
  ] = await Promise.all(
    [
      "owner",
      "actor",
      "equal",
      "admin",
      "role_target",
      "ban_target",
      "kick_target",
    ].map((name) =>
      prisma.user.create({
        data: {
          email: "hierarchy-" + name + "@t.local",
          username: "hierarchy_" + name,
          passwordHash: "x",
        },
      }),
    ),
  );

  const server = await prisma.server.create({
    data: {
      name: "Member hierarchy",
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: "owner" },
          { userId: actor.id, role: "member" },
          { userId: equalPeer.id, role: "member" },
          { userId: adminTarget.id, role: "admin" },
          { userId: lowerRoleTarget.id, role: "member" },
          { userId: lowerBanTarget.id, role: "member" },
          { userId: lowerKickTarget.id, role: "member" },
        ],
      },
    },
  });
  serverId = server.id;

  const [actorMembership, equalMembership] = await Promise.all([
    prisma.serverMember.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId: actor.id } },
    }),
    prisma.serverMember.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId: equalPeer.id } },
    }),
  ]);

  const [
    actorRole,
    equalMemberRole,
    equalDefinitionRole,
    lowAssignableRole,
    editableBelowRole,
  ] = await Promise.all([
    prisma.role.create({
      data: {
        serverId,
        name: "Custom moderator",
        position: 60,
        permissions: JSON.stringify([
          "MANAGE_ROLES",
          "BAN_MEMBERS",
          "KICK_MEMBERS",
        ]),
      },
    }),
    prisma.role.create({
      data: {
        serverId,
        name: "Equal peer",
        position: 60,
        permissions: "[]",
      },
    }),
    prisma.role.create({
      data: {
        serverId,
        name: "Equal definition",
        position: 60,
        permissions: "[]",
      },
    }),
    prisma.role.create({
      data: {
        serverId,
        name: "Low assignable",
        position: 10,
        permissions: "[]",
      },
    }),
    prisma.role.create({
      data: {
        serverId,
        name: "Editable below",
        position: 20,
        permissions: "[]",
      },
    }),
  ]);
  actorRoleId = actorRole.id;
  equalMemberRoleId = equalMemberRole.id;
  equalDefinitionRoleId = equalDefinitionRole.id;
  lowAssignableRoleId = lowAssignableRole.id;
  editableBelowRoleId = editableBelowRole.id;

  await prisma.serverMemberRole.createMany({
    data: [
      { memberId: actorMembership.id, roleId: actorRoleId },
      { memberId: equalMembership.id, roleId: equalMemberRoleId },
    ],
  });
});

beforeEach(() => {
  mocks.notifyRealtimeAuthorizationChange.mockClear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("member hierarchy across legacy and custom role endpoints", () => {
  it("lets a custom MANAGE_ROLES actor change a lower legacy role", async () => {
    signIn(actor);
    const response = await changeLegacyRole(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/members/" + lowerRoleTarget.id,
        "PATCH",
        { role: "mod" },
      ),
      memberParams(lowerRoleTarget.id),
    );

    expect(response.status).toBe(200);
    expect(mocks.notifyRealtimeAuthorizationChange).toHaveBeenCalledWith({
      scope: "server",
      serverId,
      userId: lowerRoleTarget.id,
    });
  });

  it("does not let a custom actor change a higher legacy member", async () => {
    signIn(actor);
    const response = await changeLegacyRole(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/members/" + adminTarget.id,
        "PATCH",
        { role: "member" },
      ),
      memberParams(adminTarget.id),
    );
    expect(response.status).toBe(403);
    expect(mocks.notifyRealtimeAuthorizationChange).not.toHaveBeenCalled();
  });

  it("blocks custom-role assignment to an equal-position member", async () => {
    signIn(actor);
    const response = await assignCustomRoles(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/members/" + equalPeer.id + "/roles",
        "PUT",
        { roleIds: [lowAssignableRoleId] },
      ),
      memberParams(equalPeer.id),
    );

    const peerMembership = await prisma.serverMember.findUniqueOrThrow({
      where: { serverId_userId: { serverId, userId: equalPeer.id } },
    });
    await prisma.serverMemberRole.deleteMany({
      where: { memberId: peerMembership.id },
    });
    await prisma.serverMemberRole.create({
      data: { memberId: peerMembership.id, roleId: equalMemberRoleId },
    });

    expect(response.status).toBe(403);
    expect(mocks.notifyRealtimeAuthorizationChange).not.toHaveBeenCalled();
  });

  it("allows custom-role assignment strictly below the actor", async () => {
    signIn(actor);
    const response = await assignCustomRoles(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/members/" + lowerBanTarget.id + "/roles",
        "PUT",
        { roleIds: [lowAssignableRoleId] },
      ),
      memberParams(lowerBanTarget.id),
    );

    expect(response.status).toBe(200);
    expect(mocks.notifyRealtimeAuthorizationChange).toHaveBeenCalledWith({
      scope: "server",
      serverId,
      userId: lowerBanTarget.id,
    });
  });

  it("blocks BAN_MEMBERS against higher and equal targets", async () => {
    signIn(actor);
    const higher = await banMember(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/members/" + adminTarget.id,
        "PUT",
        { banned: true },
      ),
      memberParams(adminTarget.id),
    );
    const equal = await banMember(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/members/" + equalPeer.id,
        "PUT",
        { banned: true },
      ),
      memberParams(equalPeer.id),
    );

    await prisma.serverMember.updateMany({
      where: {
        serverId,
        userId: { in: [adminTarget.id, equalPeer.id] },
      },
      data: { banned: false, bannedAt: null },
    });

    expect(higher.status).toBe(403);
    expect(equal.status).toBe(403);
    expect(mocks.notifyRealtimeAuthorizationChange).not.toHaveBeenCalled();
  });

  it("allows BAN_MEMBERS against a lower target and notifies realtime", async () => {
    signIn(actor);
    const response = await banMember(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/members/" + lowerBanTarget.id,
        "PUT",
        { banned: true },
      ),
      memberParams(lowerBanTarget.id),
    );

    expect(response.status).toBe(200);
    expect(mocks.notifyRealtimeAuthorizationChange).toHaveBeenCalledWith({
      scope: "member",
      serverId,
      userId: lowerBanTarget.id,
    });
  });

  it("blocks KICK_MEMBERS against a higher target", async () => {
    signIn(actor);
    const response = await kickMember(
      new NextRequest(
        "http://test.local/api/servers/" + serverId + "/members/" + adminTarget.id,
        { method: "DELETE" },
      ),
      memberParams(adminTarget.id),
    );

    const existing = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: adminTarget.id } },
    });
    if (!existing) {
      await prisma.serverMember.create({
        data: { serverId, userId: adminTarget.id, role: "admin" },
      });
    }

    expect(response.status).toBe(403);
    expect(mocks.notifyRealtimeAuthorizationChange).not.toHaveBeenCalled();
  });

  it("allows KICK_MEMBERS against a lower target and notifies realtime", async () => {
    signIn(actor);
    const response = await kickMember(
      new NextRequest(
        "http://test.local/api/servers/" + serverId + "/members/" + lowerKickTarget.id,
        { method: "DELETE" },
      ),
      memberParams(lowerKickTarget.id),
    );

    expect(response.status).toBe(200);
    expect(mocks.notifyRealtimeAuthorizationChange).toHaveBeenCalledWith({
      scope: "member",
      serverId,
      userId: lowerKickTarget.id,
    });
  });

  it("keeps the server owner immutable", async () => {
    signIn(actor);
    const response = await banMember(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/members/" + owner.id,
        "PUT",
        { banned: true },
      ),
      memberParams(owner.id),
    );
    expect(response.status).toBe(403);
  });
});

describe("custom role definition hierarchy", () => {
  it("creates non-owner roles strictly below the actor", async () => {
    signIn(actor);
    const response = await createRole(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/roles",
        "POST",
        { name: "Created below", permissions: [] },
      ),
      { params: Promise.resolve({ serverId }) },
    );
    const body = await response.json();
    if (body.role?.id) {
      await prisma.role.delete({ where: { id: body.role.id } });
    }

    expect(response.status).toBe(201);
    expect(body.role.position).toBeLessThan(60);
    expect(mocks.notifyRealtimeAuthorizationChange).toHaveBeenCalledWith({
      scope: "server",
      serverId,
    });
  });

  it("allows editing a role strictly below the actor", async () => {
    signIn(actor);
    const response = await editRole(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/roles/" + editableBelowRoleId,
        "PATCH",
        { name: "Edited safely", position: 21 },
      ),
      roleParams(editableBelowRoleId),
    );

    expect(response.status).toBe(200);
    expect(mocks.notifyRealtimeAuthorizationChange).toHaveBeenCalledWith({
      scope: "server",
      serverId,
    });
  });

  it("rejects editing an equal role or raising a role to the actor level", async () => {
    signIn(actor);
    const equalResponse = await editRole(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/roles/" + actorRoleId,
        "PATCH",
        { name: "Self escalated" },
      ),
      roleParams(actorRoleId),
    );
    const raiseResponse = await editRole(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/roles/" + editableBelowRoleId,
        "PATCH",
        { position: 60 },
      ),
      roleParams(editableBelowRoleId),
    );

    await prisma.role.update({
      where: { id: actorRoleId },
      data: { name: "Custom moderator", position: 60 },
    });
    await prisma.role.update({
      where: { id: editableBelowRoleId },
      data: { position: 21 },
    });

    expect(equalResponse.status).toBe(403);
    expect(raiseResponse.status).toBe(403);
    expect(mocks.notifyRealtimeAuthorizationChange).not.toHaveBeenCalled();
  });

  it("rejects non-integer role positions", async () => {
    signIn(actor);
    const response = await editRole(
      jsonRequest(
        "http://test.local/api/servers/" + serverId + "/roles/" + editableBelowRoleId,
        "PATCH",
        { position: 21.5 },
      ),
      roleParams(editableBelowRoleId),
    );
    expect(response.status).toBe(400);
  });

  it("does not let a non-owner delete an equal-position role", async () => {
    signIn(actor);
    const response = await deleteRole(
      new NextRequest(
        "http://test.local/api/servers/" + serverId + "/roles/" + equalDefinitionRoleId,
        { method: "DELETE" },
      ),
      roleParams(equalDefinitionRoleId),
    );

    const existing = await prisma.role.findUnique({
      where: { id: equalDefinitionRoleId },
    });
    if (!existing) {
      await prisma.role.create({
        data: {
          id: equalDefinitionRoleId,
          serverId,
          name: "Equal definition",
          position: 60,
          permissions: "[]",
        },
      });
    }

    expect(response.status).toBe(403);
    expect(mocks.notifyRealtimeAuthorizationChange).not.toHaveBeenCalled();
  });
});
