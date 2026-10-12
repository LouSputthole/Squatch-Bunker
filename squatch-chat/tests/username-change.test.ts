import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { verifyToken } from "@/lib/auth";

// PATCH /api/auth/me — username change + the statusMessage field it shares.

const sessionMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getSession: sessionMock.getSession,
}));

import { PATCH } from "@/app/api/auth/me/route";

const tag = Math.random().toString(36).slice(2, 8);
let user: { id: string; username: string };
let other: { id: string; username: string };
let guest: { id: string; username: string };

function patch(body: unknown) {
  return PATCH(new Request("http://test.local/api/auth/me", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

function signIn(u: { id: string; username: string }) {
  sessionMock.getSession.mockResolvedValue({ userId: u.id, username: u.username, tokenVersion: 0 });
}

beforeAll(async () => {
  user = await prisma.user.create({
    data: { email: `rename-${tag}@t.local`, username: `rename_${tag}`, passwordHash: "x", statusMessage: "by the fire" },
    select: { id: true, username: true },
  });
  other = await prisma.user.create({
    data: { email: `rename-other-${tag}@t.local`, username: `taken_${tag}`, passwordHash: "x" },
    select: { id: true, username: true },
  });
  guest = await prisma.user.create({
    data: {
      email: `guest-rename-${tag}@campfire.local`,
      username: `visitor#${tag}`,
      passwordHash: "x",
      isGuest: true,
      guestExpiresAt: new Date(Date.now() + 60 * 60_000),
    },
    select: { id: true, username: true },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PATCH /api/auth/me username", () => {
  it("renames, keeps the status message, and re-mints the session cookie", async () => {
    signIn(user);
    const res = await patch({ username: `  renamed_${tag}  ` });
    expect(res.status).toBe(200);
    expect((await res.json()).user.username).toBe(`renamed_${tag}`);

    const row = await prisma.user.findUnique({ where: { id: user.id } });
    expect(row?.username).toBe(`renamed_${tag}`);
    expect(row?.statusMessage).toBe("by the fire");

    const cookie = /=([^;]+);/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
    expect(verifyToken(cookie)).toMatchObject({ userId: user.id, username: `renamed_${tag}`, tokenVersion: row?.tokenVersion });
  });

  it("rejects taken and invalid names, and guests", async () => {
    signIn(user);
    expect((await patch({ username: other.username })).status).toBe(409);
    expect((await patch({ username: "x" })).status).toBe(400);
    expect((await patch({ username: 42 })).status).toBe(400);
    signIn(guest);
    expect((await patch({ username: `real_name_${tag}` })).status).toBe(403);
    expect((await prisma.user.findUnique({ where: { id: guest.id } }))?.username).toBe(guest.username);
  });

  it("a status-only update leaves the username and sets no cookie", async () => {
    signIn(other);
    const res = await patch({ statusMessage: "roasting marshmallows" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toBeNull();
    const row = await prisma.user.findUnique({ where: { id: other.id } });
    expect(row).toMatchObject({ username: other.username, statusMessage: "roasting marshmallows" });
  });

  it("rate-limits username changes per user", async () => {
    signIn(other);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await patch({ username: `spin_${i}_${tag}` })).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});
