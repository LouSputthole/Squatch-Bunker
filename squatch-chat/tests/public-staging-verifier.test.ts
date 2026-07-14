import { describe, expect, it, vi } from "vitest";
import {
  PublicStagingVerificationError,
  type RealtimeProbe,
  type RealtimeProbeInput,
  verifyPublicStaging,
} from "../scripts/public-staging-verifier";

const ORIGIN = "https://stage.campfire.test";
const COOKIE_VALUE = "header.payload.signature-secret";
const COOKIE_PAIR = `campfire-session=${COOKIE_VALUE}`;
const TURN_UDP_URL = "turn:turn.campfire.test:3478?transport=udp";
const TURN_TLS_URL = "turns:turn.campfire.test:5349?transport=tcp";
const TURN_TLS_DEFAULT_URL = "turns:turn.campfire.test:5349";
const TURN_URLS = [TURN_UDP_URL, TURN_TLS_URL] as const;
const TURN_USERNAME = "turn-user-secret";
const TURN_CREDENTIAL = "turn-password-secret";
const PERSISTED_USER_ID = "11111111-1111-4111-8111-111111111111";
const BETA_ACCESS_CODE = "invited-beta-code-secret";

interface HarnessOptions {
  authenticatedTurnExpiresAt?: number | null;
  authenticatedTurnMissing?: boolean;
  authenticatedTurnUrl?: unknown;
  authenticatedTurnUrls?: unknown;
  controlReconnectFails?: boolean;
  healthNoStore?: boolean;
  hostileAccepted?: boolean;
  hsts?: string | null;
  nonPersistentGuest?: boolean;
  publicTurnLeak?: boolean;
  publicTurnUrl?: unknown;
  publicTurnUrls?: unknown;
  requiredBetaAccessCode?: string;
  sessionSetCookie?: string;
  socketUrl?: string;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function runtimeConfig(authenticated: boolean, options: HarnessOptions) {
  const hasTurn = authenticated && !options.authenticatedTurnMissing;
  const publicLeak = !authenticated && options.publicTurnLeak;
  const authenticatedTurnUrls = "authenticatedTurnUrls" in options
    ? options.authenticatedTurnUrls
    : [...TURN_URLS];
  const publicTurnUrls = "publicTurnUrls" in options
    ? options.publicTurnUrls
    : publicLeak
      ? [...TURN_URLS]
      : [];
  const turnUrls = authenticated
    ? hasTurn
      ? authenticatedTurnUrls
      : []
    : publicTurnUrls;
  const defaultTurnUrl = Array.isArray(turnUrls) && typeof turnUrls[0] === "string"
    ? turnUrls[0]
    : TURN_UDP_URL;
  const turnUrl = authenticated
    ? hasTurn
      ? "authenticatedTurnUrl" in options
        ? options.authenticatedTurnUrl
        : defaultTurnUrl
      : ""
    : "publicTurnUrl" in options
      ? options.publicTurnUrl
      : publicLeak
        ? defaultTurnUrl
        : "";
  return {
    edition: "community",
    billingEnabled: false,
    appUrl: ORIGIN,
    socketUrl: options.socketUrl ?? ORIGIN,
    socketPath: "/api/socketio",
    turnUrls,
    turnUrl,
    turnExpiresAt:
      hasTurn || publicLeak
        ? "authenticatedTurnExpiresAt" in options
          ? options.authenticatedTurnExpiresAt
          : Date.now() + 15 * 60 * 1_000
        : null,
    turnUsername: hasTurn || publicLeak ? TURN_USERNAME : "",
    turnCredential: hasTurn || publicLeak ? TURN_CREDENTIAL : "",
    sfuAvailable: false,
  };
}

function makeHarness(options: HarnessOptions = {}) {
  const reports: string[] = [];
  const sessionSetCookie =
    options.sessionSetCookie ??
    `${COOKIE_PAIR}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=604800`;

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        input instanceof URL
          ? input
          : typeof input === "string"
            ? new URL(input)
            : new URL(input.url);
      const headers = new Headers(init?.headers);
      const authenticated = headers.get("cookie") === COOKIE_PAIR;

      if (url.pathname === "/api/health") {
        const responseHeaders: Record<string, string> = {
          "cache-control":
            options.healthNoStore === false ? "public, max-age=60" : "no-store",
        };
        if (options.hsts !== null) {
          responseHeaders["strict-transport-security"] =
            options.hsts ?? "max-age=31536000";
        }
        return jsonResponse({ status: "ok" }, 200, responseHeaders);
      }

      if (url.pathname === "/api/auth/me") {
        return authenticated
          ? jsonResponse({ user: { id: PERSISTED_USER_ID, username: "verify-fixed#deadbeef" } })
          : jsonResponse({ error: "Not authenticated" }, 401);
      }

      if (url.pathname === "/api/config") {
        return jsonResponse(runtimeConfig(authenticated, options), 200, {
          "cache-control": "private, no-store",
        });
      }

      if (url.pathname === "/api/auth/guest" && init?.method === "POST") {
        const body =
          typeof init.body === "string"
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {};
        if (
          options.requiredBetaAccessCode &&
          body.betaAccessCode !== options.requiredBetaAccessCode
        ) {
          return jsonResponse(
            { error: `Invalid beta access code: ${options.requiredBetaAccessCode}` },
            403,
          );
        }
        return jsonResponse(
          {
            user: {
              id: options.nonPersistentGuest ? "guest-fallback-id" : PERSISTED_USER_ID,
              username: "verify-fixed#deadbeef",
              email: null,
              isGuest: true,
            },
          },
          201,
          { "set-cookie": sessionSetCookie },
        );
      }

      if (url.pathname === "/api/auth/logout" && init?.method === "POST") {
        return jsonResponse({ ok: true }, 200, {
          "set-cookie":
            "campfire-session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
        });
      }

      throw new Error(`Unexpected request: ${url.pathname}`);
    },
  );

  let allowedConnections = 0;
  const realtimeProbe: RealtimeProbe = vi.fn(
    async (input: RealtimeProbeInput): Promise<void> => {
      if (input.origin !== ORIGIN) {
        if (options.hostileAccepted) return;
        throw new Error("Origin rejected");
      }
      if (!input.cookie) throw new Error("Session rejected");
      allowedConnections += 1;
      if (options.controlReconnectFails && allowedConnections === 2) {
        throw new Error("Control reconnect failed");
      }
    },
  );

  return {
    fetchImpl: fetchMock as unknown as typeof fetch,
    fetchMock,
    realtimeProbe,
    reports,
    report: (message: string) => reports.push(message),
  };
}

function pathsRequested(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => {
    if (input instanceof URL) return input.pathname;
    if (typeof input === "string") return new URL(input).pathname;
    return new URL((input as Request).url).pathname;
  });
}

async function expectAuthenticatedTurnFailure(
  options: HarnessOptions,
  expected: RegExp,
): Promise<void> {
  const harness = makeHarness(options);
  await expect(
    verifyPublicStaging(ORIGIN, {
      fetchImpl: harness.fetchImpl,
      realtimeProbe: harness.realtimeProbe,
      randomId: () => "fixed",
    }),
  ).rejects.toThrow(expected);
  expect(pathsRequested(harness.fetchMock)).toContain("/api/auth/logout");
}

describe("public staging verifier", () => {
  it("covers the public beta path without printing session or TURN secrets", async () => {
    const harness = makeHarness({ requiredBetaAccessCode: BETA_ACCESS_CODE });
    const result = await verifyPublicStaging(ORIGIN, {
      betaAccessCode: BETA_ACCESS_CODE,
      fetchImpl: harness.fetchImpl,
      realtimeProbe: harness.realtimeProbe,
      randomId: () => "fixed",
      report: harness.report,
      timeoutMs: 1_000,
    });

    expect(result).toMatchObject({ origin: ORIGIN, checks: 9 });
    expect(result.manualChecks).toHaveLength(2);
    const manualEvidence = result.manualChecks.join("\n");
    expect(manualEvidence).toContain("real two-device TURN-only calls");
    expect(manualEvidence).toContain("relayProtocol udp");
    expect(manualEvidence).toContain("relayProtocol tls");
    expect(harness.realtimeProbe).toHaveBeenCalledTimes(4);
    expect(vi.mocked(harness.realtimeProbe).mock.calls.map(([input]) => input.origin)).toEqual([
      ORIGIN,
      "https://campfire-verifier.invalid",
      ORIGIN,
      ORIGIN,
    ]);
    expect(
      harness.fetchMock.mock.calls.every(([, init]) => init?.redirect === "error"),
    ).toBe(true);
    expect(pathsRequested(harness.fetchMock)).toContain("/api/auth/logout");

    const output = harness.reports.join("\n");
    for (const secret of [
      COOKIE_VALUE,
      ...TURN_URLS,
      TURN_USERNAME,
      TURN_CREDENTIAL,
      BETA_ACCESS_CODE,
    ]) {
      expect(output).not.toContain(secret);
    }
  });

  it("rejects non-HTTPS targets before making a request", async () => {
    const harness = makeHarness();
    await expect(
      verifyPublicStaging("http://stage.campfire.test", {
        fetchImpl: harness.fetchImpl,
        realtimeProbe: harness.realtimeProbe,
      }),
    ).rejects.toThrow(/must use HTTPS/);
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });

  it("requires HSTS and no-store proxy behavior", async () => {
    const missingHsts = makeHarness({ hsts: null });
    await expect(
      verifyPublicStaging(ORIGIN, {
        fetchImpl: missingHsts.fetchImpl,
        realtimeProbe: missingHsts.realtimeProbe,
      }),
    ).rejects.toThrow(/Strict-Transport-Security/);

    const cacheableHealth = makeHarness({ healthNoStore: false });
    await expect(
      verifyPublicStaging(ORIGIN, {
        fetchImpl: cacheableHealth.fetchImpl,
        realtimeProbe: cacheableHealth.realtimeProbe,
      }),
    ).rejects.toThrow(/Cache-Control: no-store/);
  });

  it("fails if anonymous runtime config leaks TURN URLs or credentials", async () => {
    const harness = makeHarness({ publicTurnLeak: true });
    await expect(
      verifyPublicStaging(ORIGIN, {
        fetchImpl: harness.fetchImpl,
        realtimeProbe: harness.realtimeProbe,
      }),
    ).rejects.toThrow(/exposed TURN URLs or credentials/);
    expect(pathsRequested(harness.fetchMock)).not.toContain("/api/auth/guest");
  });

  it("fails if anonymous runtime config leaks only the TURN URL array", async () => {
    const harness = makeHarness({ publicTurnUrls: [TURN_UDP_URL] });
    await expect(
      verifyPublicStaging(ORIGIN, {
        fetchImpl: harness.fetchImpl,
        realtimeProbe: harness.realtimeProbe,
      }),
    ).rejects.toThrow(/exposed TURN URLs or credentials/);
    expect(pathsRequested(harness.fetchMock)).not.toContain("/api/auth/guest");
  });

  it("keeps invited-beta codes out of errors when guest access is forbidden", async () => {
    const harness = makeHarness({
      requiredBetaAccessCode: BETA_ACCESS_CODE,
    });
    const suppliedCode = "wrong-beta-code-secret";
    const failure = await verifyPublicStaging(ORIGIN, {
      betaAccessCode: suppliedCode,
      fetchImpl: harness.fetchImpl,
      realtimeProbe: harness.realtimeProbe,
      randomId: () => "fixed",
      report: harness.report,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PublicStagingVerificationError);
    const observable = `${(failure as Error).message}\n${harness.reports.join("\n")}`;
    expect(observable).toContain("CAMPFIRE_STAGING_BETA_ACCESS_CODE");
    expect(observable).not.toContain(BETA_ACCESS_CODE);
    expect(observable).not.toContain(suppliedCode);
  });

  it("requires a same-host secure runtime socket endpoint", async () => {
    const harness = makeHarness({
      socketUrl: "https://socket.campfire.test",
    });
    await expect(
      verifyPublicStaging(ORIGIN, {
        fetchImpl: harness.fetchImpl,
        realtimeProbe: harness.realtimeProbe,
      }),

    ).rejects.toThrow(/must use the staging host/);
  });
  it("rejects the guest route's non-persistent database fallback and still logs out", async () => {
    const harness = makeHarness({ nonPersistentGuest: true });
    await expect(
      verifyPublicStaging(ORIGIN, {
        fetchImpl: harness.fetchImpl,
        realtimeProbe: harness.realtimeProbe,
        randomId: () => "fixed",
      }),
    ).rejects.toThrow(/non-persistent fallback/);
    expect(pathsRequested(harness.fetchMock)).toContain("/api/auth/logout");
  });

  it("fails closed on an unsafe session cookie and still logs out", async () => {
    const harness = makeHarness({
      sessionSetCookie:
        `${COOKIE_PAIR}; Path=/; HttpOnly; SameSite=None; Max-Age=604800`,
    });
    await expect(
      verifyPublicStaging(ORIGIN, {
        fetchImpl: harness.fetchImpl,
        realtimeProbe: harness.realtimeProbe,
        randomId: () => "fixed",
      }),
    ).rejects.toThrow(/missing Secure/);
    expect(pathsRequested(harness.fetchMock)).toContain("/api/auth/logout");
  });

  it("requires authenticated TURN metadata and cleans up on failure", async () => {
    const harness = makeHarness({ authenticatedTurnMissing: true });
    await expect(
      verifyPublicStaging(ORIGIN, {
        fetchImpl: harness.fetchImpl,
        realtimeProbe: harness.realtimeProbe,
        randomId: () => "fixed",
      }),
    ).rejects.toThrow(/missing TURN URLs/);
    expect(pathsRequested(harness.fetchMock)).toContain("/api/auth/logout");
  });

  it.each([
    ["a serialized string", TURN_URLS.join(",")],
    ["a non-string entry", [TURN_UDP_URL, 5349]],
  ])("rejects turnUrls with %s", async (_caseName, authenticatedTurnUrls) => {
    await expectAuthenticatedTurnFailure(
      { authenticatedTurnUrls },
      /turnUrls must be an array of strings/,
    );
  });

  it("rejects comma-delimited pseudo-URLs inside turnUrls", async () => {
    await expectAuthenticatedTurnFailure(
      { authenticatedTurnUrls: [TURN_URLS.join(",")] },
      /comma-delimited/,
    );
  });

  it("rejects duplicate turnUrls entries", async () => {
    await expectAuthenticatedTurnFailure(
      { authenticatedTurnUrls: [TURN_UDP_URL, TURN_UDP_URL, TURN_TLS_URL] },
      /duplicate entries/,
    );
  });

  it.each([
    [
      "a non-TURN scheme",
      ["stun:turn.campfire.test:3478", TURN_TLS_URL],
      /entry 0 is invalid/,
    ],
    [
      "an unsupported transport",
      ["turn:turn.campfire.test:3478?transport=sctp", TURN_TLS_URL],
      /entry 0 is invalid/,
    ],
    [
      "UDP on a secure TURN URL",
      [TURN_UDP_URL, "turns:turn.campfire.test:5349?transport=udp"],
      /entry 1 is invalid/,
    ],
  ])("rejects %s", async (_caseName, authenticatedTurnUrls, expected) => {
    await expectAuthenticatedTurnFailure(
      { authenticatedTurnUrls },
      expected,
    );
  });

  it.each([
    ["explicit UDP", [TURN_TLS_URL], /explicit UDP coverage/],
    ["secure TLS-over-TCP", [TURN_UDP_URL], /TLS-over-TCP coverage/],
  ])("requires %s TURN URL coverage", async (_caseName, authenticatedTurnUrls, expected) => {
    await expectAuthenticatedTurnFailure(
      { authenticatedTurnUrls },
      expected,
    );
  });

  it("accepts a turns: URL with the secure default transport", async () => {
    const harness = makeHarness({
      authenticatedTurnUrls: [TURN_UDP_URL, TURN_TLS_DEFAULT_URL],
    });
    const result = await verifyPublicStaging(ORIGIN, {
      fetchImpl: harness.fetchImpl,
      realtimeProbe: harness.realtimeProbe,
      randomId: () => "fixed",
    });

    expect(result.checks).toBe(9);
  });

  it("requires deprecated turnUrl to match the first turnUrls entry", async () => {
    await expectAuthenticatedTurnFailure(
      { authenticatedTurnUrl: TURN_TLS_URL },
      /legacy turnUrl must match/,
    );
  });

  it.each([
    ["legacy static", null],
    ["expired", Date.now() - 1_000],
    ["unbounded", Date.now() + 2 * 60 * 60 * 1_000],
  ])("rejects %s TURN credential expiry", async (_caseName, turnExpiresAt) => {
    const harness = makeHarness({ authenticatedTurnExpiresAt: turnExpiresAt });
    await expect(
      verifyPublicStaging(ORIGIN, {
        fetchImpl: harness.fetchImpl,
        realtimeProbe: harness.realtimeProbe,
        randomId: () => "fixed",
      }),
    ).rejects.toThrow(/future bounded expiry/);
    expect(pathsRequested(harness.fetchMock)).toContain("/api/auth/logout");
  });

  it("rejects a server that accepts a hostile realtime Origin without leaking secrets", async () => {
    const harness = makeHarness({ hostileAccepted: true });
    const failure = await verifyPublicStaging(ORIGIN, {
      fetchImpl: harness.fetchImpl,
      realtimeProbe: harness.realtimeProbe,
      randomId: () => "fixed",
      report: harness.report,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PublicStagingVerificationError);
    const message = (failure as Error).message;
    expect(message).toMatch(/Hostile-Origin Socket.IO connected/);
    expect(message).not.toContain(COOKIE_VALUE);
    expect(message).not.toContain(TURN_CREDENTIAL);
    expect(pathsRequested(harness.fetchMock)).toContain("/api/auth/logout");
  });

  it("does not count rejection probes when the live control reconnect fails", async () => {
    const harness = makeHarness({ controlReconnectFails: true });
    await expect(
      verifyPublicStaging(ORIGIN, {
        fetchImpl: harness.fetchImpl,
        realtimeProbe: harness.realtimeProbe,
        randomId: () => "fixed",
      }),
    ).rejects.toThrow(/control reconnect failed/);
    expect(pathsRequested(harness.fetchMock)).toContain("/api/auth/logout");
  });
});
