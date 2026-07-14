import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => authMock);
vi.mock("@/lib/sfu", () => ({ sfuConfigured: () => false }));
vi.mock("@/lib/edition", () => ({
  billingConfiguration: () => ({ enabled: false }),
  getEdition: () => "community",
}));

import { GET } from "@/app/api/config/route";

const NOW_MS = 1_700_000_000_000;
const STRONG_SECRET = "test-turn-secret-0123456789abcdef";
const TURN_URLS = [
  "turn:turn.campfire.test:3478?transport=udp",
  "turn:turn.campfire.test:3478?transport=tcp",
  "turns:turn.campfire.test:5349?transport=tcp",
];

function requestConfig() {
  return GET(new Request("https://campfire.test/api/config", {
    headers: { host: "campfire.test", "x-forwarded-proto": "https" },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
  vi.stubEnv("TURN_URLS", JSON.stringify(TURN_URLS));
  vi.stubEnv("TURN_URL", "turn:fallback.campfire.test:3478");
  vi.stubEnv("TURN_AUTH_SECRET", STRONG_SECRET);
  vi.stubEnv("TURN_CREDENTIAL_TTL_SECONDS", "900");
  vi.stubEnv("TURN_USERNAME", "");
  vi.stubEnv("TURN_CREDENTIAL", "");
  vi.stubEnv("TURN_ALLOW_LEGACY_STATIC_CREDENTIALS", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/config TURN credentials", () => {
  it("never gives TURN credentials or the shared secret to an anonymous caller", async () => {
    authMock.getSession.mockResolvedValue(null);

    const response = await requestConfig();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Cookie");

    const body = await response.json();
    expect(body).toMatchObject({
      turnUrls: [],
      turnUrl: "",
      turnUsername: "",
      turnCredential: "",
      turnExpiresAt: null,
    });
    expect(JSON.stringify(body)).not.toContain(STRONG_SECRET);
  });

  it.each([
    ["registered user", { userId: "user_123", username: "lou", tokenVersion: 0 }],
    ["guest user", { userId: "guest_456", username: "Guest", tokenVersion: 0, guest: true }],
  ])("mints a bounded per-session credential for a %s", async (_label, session) => {
    authMock.getSession.mockResolvedValue(session);
    vi.stubEnv("TURN_USERNAME", "legacy-user");
    vi.stubEnv("TURN_CREDENTIAL", "legacy-password");
    vi.stubEnv("TURN_ALLOW_LEGACY_STATIC_CREDENTIALS", "1");

    const response = await requestConfig();
    const body = await response.json();

    expect(body.turnUrls).toEqual(TURN_URLS);
    expect(body.turnUrl).toBe(TURN_URLS[0]);
    expect(body.turnUsername).toBe(`1700000775:${session.userId}`);
    expect(body.turnCredential).not.toBe("legacy-password");
    expect(body.turnExpiresAt).toBe(1_700_000_775_000);
    expect(JSON.stringify(body)).not.toContain(STRONG_SECRET);
  });

  it("fails closed rather than minting with a weak shared secret", async () => {
    authMock.getSession.mockResolvedValue({
      userId: "user_123",
      username: "lou",
      tokenVersion: 0,
    });
    vi.stubEnv("TURN_AUTH_SECRET", "too-short");

    await expect(requestConfig()).rejects.toThrow("at least 32 characters");
  });

  it("requires an explicit opt-in before using legacy static credentials", async () => {
    authMock.getSession.mockResolvedValue({
      userId: "user_123",
      username: "lou",
      tokenVersion: 0,
    });
    vi.stubEnv("TURN_AUTH_SECRET", "");
    vi.stubEnv("TURN_URLS", "");
    vi.stubEnv("TURN_URL", "turns:turn.campfire.test:5349");
    vi.stubEnv("TURN_USERNAME", "legacy-user");
    vi.stubEnv("TURN_CREDENTIAL", "legacy-password");

    const disabled = await (await requestConfig()).json();
    expect(disabled).toMatchObject({
      turnUrls: [],
      turnUrl: "",
      turnUsername: "",
      turnCredential: "",
      turnExpiresAt: null,
    });

    vi.stubEnv("TURN_ALLOW_LEGACY_STATIC_CREDENTIALS", "1");
    const enabled = await (await requestConfig()).json();
    expect(enabled).toMatchObject({
      turnUrls: ["turns:turn.campfire.test:5349"],
      turnUrl: "turns:turn.campfire.test:5349",
      turnUsername: "legacy-user",
      turnCredential: "legacy-password",
      turnExpiresAt: null,
    });
  });
});
