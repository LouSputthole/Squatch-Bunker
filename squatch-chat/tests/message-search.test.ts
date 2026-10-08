import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { containsInsensitive, prisma } from "@/lib/db";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

import { GET as searchMessages } from "@/app/api/messages/search/route";
import { GET as searchUsers } from "@/app/api/users/search/route";

let serverId: string;
let aliceId: string;

async function search(params: Record<string, string>) {
  const query = new URLSearchParams({ serverId, ...params });
  return searchMessages(new Request(`http://test.local/api/messages/search?${query}`));
}

async function contents(params: Record<string, string>) {
  const response = await search(params);
  expect(response.status).toBe(200);
  const body = await response.json();
  return body.results.map((m: { content: string }) => m.content).sort();
}

beforeAll(async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [alice, bob] = await Promise.all([
    prisma.user.create({
      data: { email: `search-alice-${suffix}@t.local`, username: `Alice${suffix}`, passwordHash: "x" },
    }),
    prisma.user.create({
      data: { email: `search-bob-${suffix}@t.local`, username: `Bob${suffix}`, passwordHash: "x" },
    }),
  ]);
  aliceId = alice.id;
  const server = await prisma.server.create({ data: { name: "Search", ownerId: alice.id } });
  serverId = server.id;
  await prisma.serverMember.createMany({
    data: [
      { serverId, userId: alice.id, role: "owner" },
      { serverId, userId: bob.id, role: "member" },
    ],
  });
  const channel = await prisma.channel.create({ data: { serverId, name: "search" } });
  await prisma.message.createMany({
    data: [
      { channelId: channel.id, authorId: alice.id, content: "Campfire on the 1st", createdAt: new Date("2026-03-01T10:00:00Z") },
      { channelId: channel.id, authorId: bob.id, content: "campfire on the 2nd", createdAt: new Date("2026-03-02T23:59:59Z") },
      { channelId: channel.id, authorId: alice.id, content: "CAMPFIRE on the 3rd", createdAt: new Date("2026-03-03T00:00:00Z") },
    ],
  });
  authMock.getSession.mockResolvedValue({ userId: alice.id, username: alice.username });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/messages/search filters", () => {
  it("matches text case-insensitively", async () => {
    expect(await contents({ q: "campFIRE" })).toHaveLength(3);
  });

  it("filters by author username (case-insensitive, optional @)", async () => {
    const bobs = await contents({ q: "campfire", user: "@bob" });
    expect(bobs).toEqual(["campfire on the 2nd"]);
  });

  it("treats from/to as an inclusive range of whole UTC days", async () => {
    expect(await contents({ q: "campfire", from: "2026-03-02" })).toEqual([
      "CAMPFIRE on the 3rd",
      "campfire on the 2nd",
    ]);
    expect(await contents({ q: "campfire", to: "2026-03-02" })).toEqual([
      "Campfire on the 1st",
      "campfire on the 2nd",
    ]);
    expect(await contents({ q: "campfire", from: "2026-03-02", to: "2026-03-02" })).toEqual([
      "campfire on the 2nd",
    ]);
  });

  it("rejects malformed or inverted dates", async () => {
    expect((await search({ q: "campfire", from: "yesterday" })).status).toBe(400);
    expect((await search({ q: "campfire", to: "2026-02-30" })).status).toBe(400);
    expect((await search({ q: "campfire", from: "2026-03-03", to: "2026-03-01" })).status).toBe(400);
  });
});

describe("GET /api/users/search", () => {
  it("matches usernames case-insensitively", async () => {
    authMock.getSession.mockResolvedValue({ userId: aliceId, username: "alice" });
    const response = await searchUsers(new NextRequest("http://test.local/api/users/search?q=BOB"));
    const body = await response.json();
    expect(body.users.some((u: { username: string }) => u.username.startsWith("Bob"))).toBe(true);
  });
});

describe("containsInsensitive", () => {
  it("adds PostgreSQL's insensitive mode and leaves SQLite LIKE alone", () => {
    expect(containsInsensitive("Fire")).toEqual({ contains: "Fire" });
    vi.stubEnv("DATABASE_URL", "postgresql://campfire@localhost:5432/campfire");
    try {
      expect(containsInsensitive("Fire")).toEqual({ contains: "Fire", mode: "insensitive" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
