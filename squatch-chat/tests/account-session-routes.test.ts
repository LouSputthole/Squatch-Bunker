import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { hashPassword, verifyToken } from "@/lib/auth";

const sessionMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  getSession: sessionMock.getSession,
}));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as upgrade } from "@/app/api/auth/upgrade/route";

let requestNumber = 0;
const suffix = Math.random().toString(36).slice(2, 8);

function post(url: string, body: unknown) {
  requestNumber += 1;
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${requestNumber}` },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function sessionCookie(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /=([^;]+);/.exec(header);
  return match?.[1] ?? "";
}

afterEach(() => {
  vi.unstubAllEnvs();
  sessionMock.getSession.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("POST /api/auth/login", () => {
  it("normalizes the email the way registration stores it", async () => {
    await prisma.user.create({
      data: {
        email: `login-${suffix}@campfire.test`,
        username: `login_${suffix}`,
        passwordHash: await hashPassword("correct horse"),
      },
    });
    const response = await login(post("http://test.local/api/auth/login", {
      email: `  LOGIN-${suffix}@Campfire.Test `,
      password: "correct horse",
    }));
    expect(response.status).toBe(200);
  });

  it("still finds a legacy account stored with mixed case", async () => {
    await prisma.user.create({
      data: {
        email: `Legacy-${suffix}@Campfire.test`,
        username: `legacy_${suffix}`,
        passwordHash: await hashPassword("correct horse"),
      },
    });
    const response = await login(post("http://test.local/api/auth/login", {
      email: `Legacy-${suffix}@Campfire.test`,
      password: "correct horse",
    }));
    expect(response.status).toBe(200);
  });

  it("rejects non-string credentials with 400", async () => {
    expect((await login(post("http://test.local/api/auth/login", { email: ["a"], password: "x" }))).status).toBe(400);
    expect((await login(post("http://test.local/api/auth/login", "{"))).status).toBe(400);
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the cookie with the same Secure/SameSite flags used to set it", async () => {
    vi.stubEnv("COOKIE_SECURE", "1");
    const cookie = (await logout()).headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/Max-Age=0/);
    expect(cookie).toMatch(/SameSite=None/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\//);
  });
});

describe("guest accounts", () => {
  async function makeGuest(label: string) {
    return prisma.user.create({
      data: {
        email: `guest-${label}-${suffix}@campfire.local`,
        username: `Guest${label}#${suffix}`,
        passwordHash: "x",
        isGuest: true,
        guestExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
  }

  it("/api/auth/me reports guest status and expiry", async () => {
    const guest = await makeGuest("me");
    sessionMock.getSession.mockResolvedValue({ userId: guest.id, username: guest.username });
    const { user } = await (await me()).json();
    expect(user).toMatchObject({ id: guest.id, isGuest: true });
    expect(new Date(user.guestExpiresAt).getTime()).toBe(guest.guestExpiresAt!.getTime());
  });

  it("upgrade validates like registration and re-mints the session", async () => {
    const guest = await makeGuest("up");
    sessionMock.getSession.mockResolvedValue({ userId: guest.id, username: guest.username });
    const url = "http://test.local/api/auth/upgrade";

    expect((await upgrade(post(url, { email: 5, username: "x", password: "y" }))).status).toBe(400);
    expect((await upgrade(post(url, { email: "a@b.co", username: "camper", password: "short" }))).status).toBe(400);
    expect((await upgrade(post(url, "{"))).status).toBe(400);

    const response = await upgrade(post(url, {
      email: `  Upgraded-${suffix}@Campfire.TEST `,
      username: `  camper_${suffix} `,
      password: "long enough password",
    }));
    expect(response.status).toBe(200);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: guest.id } });
    expect(stored).toMatchObject({
      email: `upgraded-${suffix}@campfire.test`,
      username: `camper_${suffix}`,
      isGuest: false,
      guestExpiresAt: null,
    });
    expect(verifyToken(sessionCookie(response))).toMatchObject({
      userId: guest.id,
      username: `camper_${suffix}`,
      tokenVersion: stored.tokenVersion,
    });
  });

  it("upgrade refuses an email that registration would treat as taken", async () => {
    await prisma.user.create({
      data: { email: `taken-${suffix}@campfire.test`, username: `taken_${suffix}`, passwordHash: "x" },
    });
    const guest = await makeGuest("taken");
    sessionMock.getSession.mockResolvedValue({ userId: guest.id, username: guest.username });
    const response = await upgrade(post("http://test.local/api/auth/upgrade", {
      email: `TAKEN-${suffix}@campfire.test`,
      username: `fresh_${suffix}`,
      password: "long enough password",
    }));
    expect(response.status).toBe(409);
  });
});
