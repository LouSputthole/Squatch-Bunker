import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  getInviteAvailability,
  parseInviteRegeneration,
  remainingInviteUses,
} from "@/lib/invites";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET as previewInvite } from "@/app/api/servers/preview/route";
import { POST as joinServer } from "@/app/api/servers/join/route";
import { PATCH as patchServer } from "@/app/api/servers/[serverId]/route";

let owner: { id: string; username: string };
let memberA: { id: string; username: string };
let memberB: { id: string; username: string };

beforeAll(async () => {
  owner = await prisma.user.create({
    data: { email: "invite-owner@t.local", username: "invite_owner", passwordHash: "x" },
  });
  memberA = await prisma.user.create({
    data: { email: "invite-a@t.local", username: "invite_a", passwordHash: "x" },
  });
  memberB = await prisma.user.create({
    data: { email: "invite-b@t.local", username: "invite_b", passwordHash: "x" },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createServer(
  invite?: Partial<{
    inviteExpiresAt: Date | null;
    inviteMaxUses: number | null;
    inviteUseCount: number;
    inviteRevokedAt: Date | null;
  }>,
) {
  return prisma.server.create({
    data: {
      name: `Invite Test ${crypto.randomUUID()}`,
      ownerId: owner.id,
      ...invite,
      members: { create: { userId: owner.id, role: "owner" } },
      channels: { create: { name: "campfire", type: "text" } },
    },
    include: { channels: true },
  });
}

function preview(code: string) {
  return previewInvite(
    new Request(
      `http://test.local/api/servers/preview?inviteCode=${encodeURIComponent(code)}`,
    ),
  );
}

function join(code: string) {
  return joinServer(
    new Request("http://test.local/api/servers/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviteCode: code }),
    }),
  );
}

function updateServer(serverId: string, body: Record<string, unknown>) {
  return patchServer(
    new Request(`http://test.local/api/servers/${serverId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ serverId }) },
  );
}

function signIn(user: { id: string; username: string }) {
  authMock.getSession.mockResolvedValue({
    userId: user.id,
    username: user.username,
  });
}

describe("managed invite domain rules", () => {
  const active = {
    inviteExpiresAt: null,
    inviteMaxUses: 3,
    inviteUseCount: 1,
    inviteRevokedAt: null,
  };

  it("prioritizes revocation, expiry, and exhaustion over active state", () => {
    expect(getInviteAvailability(active)).toBe("active");
    expect(
      getInviteAvailability({ ...active, inviteRevokedAt: new Date() }),
    ).toBe("revoked");
    expect(
      getInviteAvailability({
        ...active,
        inviteExpiresAt: new Date(Date.now() - 1_000),
      }),
    ).toBe("expired");
    expect(
      getInviteAvailability({ ...active, inviteUseCount: 3 }),
    ).toBe("exhausted");
    expect(remainingInviteUses(active)).toBe(2);
  });

  it("validates regeneration expiry and use bounds", () => {
    expect(parseInviteRegeneration({ inviteExpiresInSeconds: 59 }).ok).toBe(false);
    expect(parseInviteRegeneration({ inviteMaxUses: 0 }).ok).toBe(false);
    expect(
      parseInviteRegeneration({
        inviteExpiresInSeconds: 3600,
        inviteMaxUses: 5,
      }).ok,
    ).toBe(true);
  });
});

describe("GET /api/servers/preview", () => {
  it("requires authentication and returns only preview metadata", async () => {
    const server = await createServer({ inviteMaxUses: 3 });
    authMock.getSession.mockResolvedValueOnce(null);
    expect((await preview(server.inviteCode)).status).toBe(401);

    signIn(memberA);
    const response = await preview(server.inviteCode);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      server: { id: server.id, name: server.name },
      alreadyMember: false,
      invite: { maxUses: 3, useCount: 0, remainingUses: 3 },
    });
    expect(body.server.channels).toBeUndefined();
  });

  it("rejects inactive links for newcomers but still recognizes members", async () => {
    const server = await createServer({ inviteRevokedAt: new Date() });
    signIn(memberA);
    const newcomer = await preview(server.inviteCode);
    expect(newcomer.status).toBe(410);
    expect((await newcomer.json()).inviteStatus).toBe("revoked");

    signIn(owner);
    const existing = await preview(server.inviteCode);
    expect(existing.status).toBe(200);
    expect((await existing.json()).alreadyMember).toBe(true);
  });
});

describe("POST /api/servers/join", () => {
  it("consumes one use for a new member and never charges that member twice", async () => {
    const server = await createServer({ inviteMaxUses: 2 });
    signIn(memberA);

    const first = await join(server.inviteCode);
    expect(first.status).toBe(201);
    expect(
      (
        await prisma.server.findUniqueOrThrow({ where: { id: server.id } })
      ).inviteUseCount,
    ).toBe(1);

    const second = await join(server.inviteCode);
    expect(second.status).toBe(200);
    expect((await second.json()).alreadyMember).toBe(true);
    expect(
      (
        await prisma.server.findUniqueOrThrow({ where: { id: server.id } })
      ).inviteUseCount,
    ).toBe(1);
  });

  it("rejects a newcomer after the atomic use limit is exhausted", async () => {
    const server = await createServer({ inviteMaxUses: 1 });
    signIn(memberA);
    expect((await join(server.inviteCode)).status).toBe(201);

    signIn(memberB);
    const exhausted = await join(server.inviteCode);
    expect(exhausted.status).toBe(410);
    expect((await exhausted.json()).inviteStatus).toBe("exhausted");
    expect(
      await prisma.serverMember.findUnique({
        where: {
          serverId_userId: { serverId: server.id, userId: memberB.id },
        },
      }),
    ).toBeNull();
  });
});

describe("PATCH /api/servers/[serverId] managed invite", () => {
  it("lets only the owner revoke and rotate the link with fresh limits", async () => {
    const server = await createServer({ inviteUseCount: 4 });
    signIn(memberA);
    expect(
      (await updateServer(server.id, { revokeInvite: true })).status,
    ).toBe(403);

    signIn(owner);
    const revoked = await updateServer(server.id, { revokeInvite: true });
    expect(revoked.status).toBe(200);
    expect((await revoked.json()).server.inviteRevokedAt).toBeTruthy();

    const rotated = await updateServer(server.id, {
      regenerateInvite: true,
      inviteExpiresInSeconds: 3600,
      inviteMaxUses: 2,
    });
    expect(rotated.status).toBe(200);
    const updated = (await rotated.json()).server;
    expect(updated.inviteCode).not.toBe(server.inviteCode);
    expect(updated.inviteUseCount).toBe(0);
    expect(updated.inviteMaxUses).toBe(2);
    expect(updated.inviteRevokedAt).toBeNull();
    expect(new Date(updated.inviteExpiresAt).getTime()).toBeGreaterThan(Date.now());

    signIn(memberB);
    expect((await preview(server.inviteCode)).status).toBe(404);
    expect((await preview(updated.inviteCode)).status).toBe(200);
  });

  it("rejects invalid settings and conflicting revoke/rotate actions", async () => {
    const server = await createServer();
    signIn(owner);
    expect(
      (
        await updateServer(server.id, {
          regenerateInvite: true,
          inviteMaxUses: 0,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await updateServer(server.id, {
          regenerateInvite: true,
          revokeInvite: true,
        })
      ).status,
    ).toBe(400);
  });
});
