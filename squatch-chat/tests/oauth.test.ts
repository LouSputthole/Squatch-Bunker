import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  prisma: {
    oAuthAccount: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
  auth: {
    createToken: vi.fn(() => "oauth-session"),
    setTokenCookie: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/auth", () => mocks.auth);

const APP_URL = "https://campfire.test";

function callbackRequest(provider: string, state = "state-value") {
  return new NextRequest(
    `${APP_URL}/api/auth/oauth/${provider}/callback?code=provider-code&state=${state}`,
    { headers: { cookie: `oauth_state_${provider}=${state}` } },
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL);
  vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
  vi.stubEnv("GITHUB_CLIENT_ID", "github-client");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
  mocks.prisma.oAuthAccount.findUnique.mockReset();
  mocks.prisma.oAuthAccount.create.mockReset();
  mocks.prisma.user.findUnique.mockReset();
  mocks.prisma.user.create.mockReset();
  mocks.auth.createToken.mockClear();
  mocks.auth.setTokenCookie.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("OAuth initiation", () => {
  it("requires both halves of provider configuration", async () => {
    vi.stubEnv("GITHUB_CLIENT_SECRET", "");
    const { GET } = await import("@/app/api/auth/oauth/[provider]/route");
    const response = await GET(
      new NextRequest(`${APP_URL}/api/auth/oauth/github`),
      { params: Promise.resolve({ provider: "github" }) },
    );

    expect(response.status).toBe(501);
  });

  it("sets a short-lived provider-bound secure state cookie", async () => {
    const { GET } = await import("@/app/api/auth/oauth/[provider]/route");
    const response = await GET(
      new NextRequest(`${APP_URL}/api/auth/oauth/google`),
      { params: Promise.resolve({ provider: "google" }) },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("accounts.google.com");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("oauth_state_google=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie.toLowerCase()).toContain("secure");
    expect(cookie).toContain("Path=/api/auth/oauth/");
  });
});

describe("OAuth callback identity verification", () => {
  it("rejects an unverified Google email before any account lookup or link", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ access_token: "provider-token" }),
        { status: 200 },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          id: "google-user",
          email: "unverified@example.com",
          verified_email: false,
          name: "Unverified",
          picture: null,
        }),
        { status: 200 },
      ));
    const { GET } = await import("@/app/api/auth/oauth/[provider]/callback/route");
    const response = await GET(
      callbackRequest("google"),
      { params: Promise.resolve({ provider: "google" }) },
    );

    expect(response.headers.get("location")).toBe(`${APP_URL}/?error=oauth_no_email`);
    expect(mocks.prisma.oAuthAccount.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("normalizes a verified email before linking an existing account", async () => {
    const existingUser = {
      id: "existing-user",
      email: "camper@example.com",
      username: "camper",
      tokenVersion: 0,
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ access_token: "provider-token" }),
        { status: 200 },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          id: "google-user",
          email: " Camper@Example.COM ",
          verified_email: true,
          name: "Camper",
          picture: null,
        }),
        { status: 200 },
      ));
    mocks.prisma.oAuthAccount.findUnique.mockResolvedValue(null);
    mocks.prisma.user.findUnique.mockResolvedValue(existingUser);
    mocks.prisma.oAuthAccount.create.mockResolvedValue({ id: "link" });

    const { GET } = await import("@/app/api/auth/oauth/[provider]/callback/route");
    const response = await GET(
      callbackRequest("google"),
      { params: Promise.resolve({ provider: "google" }) },
    );

    expect(response.headers.get("location")).toBe(`${APP_URL}/chat`);
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "camper@example.com" },
    });
    expect(mocks.prisma.oAuthAccount.create).toHaveBeenCalledWith({
      data: {
        userId: existingUser.id,
        provider: "google",
        providerAccountId: "google-user",
      },
    });
    expect(mocks.auth.createToken).toHaveBeenCalledWith({
      userId: existingUser.id,
      username: existingUser.username,
      tokenVersion: 0,
    });
  });
});
