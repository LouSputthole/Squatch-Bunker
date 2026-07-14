import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const NOW_MS = 1_700_000_000_000;
const TURN_URLS = [
  "turn:turn.campfire.test:3478?transport=udp",
  "turn:turn.campfire.test:3478?transport=tcp",
  "turns:turn.campfire.test:5349?transport=tcp",
];

function configResponse(
  credential: string,
  expiresAt = NOW_MS + 120_000,
): Response {
  return Response.json({
    appUrl: "https://campfire.test",
    socketUrl: "https://campfire.test",
    socketPath: "/api/socketio",
    turnUrls: TURN_URLS,
    turnUrl: TURN_URLS[0],
    turnUsername: `${Math.floor(expiresAt / 1000)}:user_123`,
    turnCredential: credential,
    turnExpiresAt: expiresAt,
    sfuAvailable: false,
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(NOW_MS);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("runtime config TURN refresh", () => {
  it("prefers the URL array and normalizes its first entry as the compatibility URL", async () => {
    const preferredUrls = [
      "turn:preferred.campfire.test:3478?transport=udp",
      "turns:preferred.campfire.test:5349?transport=tcp",
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      appUrl: "https://campfire.test",
      socketUrl: "https://campfire.test",
      socketPath: "/api/socketio",
      turnUrls: preferredUrls,
      turnUrl: "turn:legacy.campfire.test:3478",
      turnUsername: "1700000900:user_123",
      turnCredential: "credential-a",
      turnExpiresAt: NOW_MS + 900_000,
      sfuAvailable: false,
    })));
    const { ensureRuntimeConfig } = await import("@/hooks/useRuntimeConfig");

    await expect(ensureRuntimeConfig()).resolves.toMatchObject({
      turnUrls: preferredUrls,
      turnUrl: preferredUrls[0],
    });
  });

  it("normalizes a legacy turnUrl-only response into a one-entry array", async () => {
    const legacyUrl = "turns:legacy.campfire.test:5349";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      appUrl: "https://campfire.test",
      socketUrl: "https://campfire.test",
      socketPath: "/api/socketio",
      turnUrl: legacyUrl,
      turnUsername: "1700000900:user_123",
      turnCredential: "credential-a",
      turnExpiresAt: NOW_MS + 900_000,
      sfuAvailable: false,
    })));
    const { ensureRuntimeConfig } = await import("@/hooks/useRuntimeConfig");

    await expect(ensureRuntimeConfig()).resolves.toMatchObject({
      turnUrls: [legacyUrl],
      turnUrl: legacyUrl,
    });
  });

  it("deduplicates concurrent no-store requests", async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { ensureRuntimeConfig } = await import("@/hooks/useRuntimeConfig");

    const first = ensureRuntimeConfig();
    const second = ensureRuntimeConfig();
    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/config", {
      cache: "no-store",
      credentials: "same-origin",
    });

    resolveFetch(configResponse("credential-a"));
    await expect(first).resolves.toMatchObject({ turnCredential: "credential-a" });
    await expect(second).resolves.toMatchObject({ turnCredential: "credential-a" });
  });

  it("does not let a prior session's in-flight response repopulate the cache", async () => {
    let resolveOldFetch!: (response: Response) => void;
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>((resolve) => {
        resolveOldFetch = resolve;
      }))
      .mockResolvedValueOnce(configResponse("credential-new", NOW_MS + 900_000));
    vi.stubGlobal("fetch", fetchMock);
    const {
      ensureRuntimeConfig,
      getRuntimeConfig,
      invalidateRuntimeConfig,
    } = await import("@/hooks/useRuntimeConfig");

    const oldSessionRequest = ensureRuntimeConfig();
    invalidateRuntimeConfig();
    await expect(ensureRuntimeConfig({ forceRefresh: true })).resolves
      .toMatchObject({ turnCredential: "credential-new" });

    resolveOldFetch(configResponse("credential-old", NOW_MS + 900_000));
    await expect(oldSessionRequest).resolves
      .toMatchObject({ turnCredential: "credential-new" });
    expect(getRuntimeConfig()).toMatchObject({ turnCredential: "credential-new" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses fresh credentials, refreshes inside the skew, and supports a forced session refresh", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(configResponse("credential-a", NOW_MS + 120_000))
      .mockResolvedValueOnce(configResponse("credential-b", NOW_MS + 900_000))
      .mockResolvedValueOnce(configResponse("credential-c", NOW_MS + 900_000));
    vi.stubGlobal("fetch", fetchMock);
    const { ensureRuntimeConfig } = await import("@/hooks/useRuntimeConfig");

    await expect(ensureRuntimeConfig()).resolves
      .toMatchObject({ turnCredential: "credential-a" });
    await expect(ensureRuntimeConfig()).resolves
      .toMatchObject({ turnCredential: "credential-a" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW_MS + 100_000);
    await expect(ensureRuntimeConfig()).resolves
      .toMatchObject({ turnCredential: "credential-b" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await expect(ensureRuntimeConfig({ forceRefresh: true })).resolves
      .toMatchObject({ turnCredential: "credential-c" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("withholds expired credentials after a failed refresh and retries later", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(configResponse("credential-a", NOW_MS + 60_000))
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(configResponse("credential-b", NOW_MS + 900_000));
    vi.stubGlobal("fetch", fetchMock);
    const { ensureRuntimeConfig, getRuntimeConfig } = await import("@/hooks/useRuntimeConfig");

    await ensureRuntimeConfig();
    vi.setSystemTime(NOW_MS + 61_000);

    await expect(ensureRuntimeConfig()).resolves.toMatchObject({
      turnUrls: [],
      turnUrl: "",
      turnUsername: "",
      turnCredential: "",
      turnExpiresAt: null,
    });
    expect(getRuntimeConfig()).toMatchObject({
      turnUrls: [],
      turnUrl: "",
      turnCredential: "",
    });

    await expect(ensureRuntimeConfig()).resolves
      .toMatchObject({ turnCredential: "credential-b" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
