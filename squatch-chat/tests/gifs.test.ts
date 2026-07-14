import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);

function request(query = "") {
  return new NextRequest(
    `http://test.local/api/gifs${query ? `?q=${encodeURIComponent(query)}` : ""}`,
  );
}

async function loadGet() {
  vi.resetModules();
  return (await import("@/app/api/gifs/route")).GET;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  authMock.getSession.mockReset();
});

describe("GET /api/gifs", () => {
  it("requires an authenticated Campfire user", async () => {
    authMock.getSession.mockResolvedValue(null);
    const GET = await loadGet();

    expect((await GET(request())).status).toBe(401);
  });

  it("returns an empty catalog without leaking provider configuration", async () => {
    authMock.getSession.mockResolvedValue({
      userId: "gif-user-no-provider",
      username: "camper",
    });
    vi.stubEnv("GIPHY_API_KEY", "");
    vi.stubEnv("TENOR_API_KEY", "");
    const GET = await loadGet();
    const response = await GET(request("campfire"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ gifs: [] });
  });

  it("bounds search input before contacting a provider", async () => {
    authMock.getSession.mockResolvedValue({
      userId: "gif-user-long-query",
      username: "camper",
    });
    vi.stubEnv("GIPHY_API_KEY", "secret-key");
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const GET = await loadGet();

    expect((await GET(request("x".repeat(101)))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("contains upstream failures and never returns provider response bodies", async () => {
    authMock.getSession.mockResolvedValue({
      userId: "gif-user-provider-failure",
      username: "camper",
    });
    vi.stubEnv("GIPHY_API_KEY", "secret-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("provider details", { status: 503 }),
    );
    const GET = await loadGet();
    const response = await GET(request("trail"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ gifs: [] });
  });
});
