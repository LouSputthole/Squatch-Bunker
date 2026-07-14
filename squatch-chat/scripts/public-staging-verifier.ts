import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { MAX_TURN_URLS, validateTurnUrl } from "../lib/turnCredentials";

const MAX_JSON_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TURN_REMAINING_MS = 30_000;
const MAX_TURN_REMAINING_MS = 3_660_000;
const HOSTILE_ORIGIN = "https://campfire-verifier.invalid";

export class PublicStagingVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicStagingVerificationError";
  }
}

export interface RealtimeProbeInput {
  endpoint: string;
  socketPath: string;
  origin: string;
  cookie?: string;
  timeoutMs: number;
}

export type RealtimeProbe = (input: RealtimeProbeInput) => Promise<void>;

export interface PublicStagingVerifierOptions {
  betaAccessCode?: string;
  fetchImpl?: typeof fetch;
  realtimeProbe?: RealtimeProbe;
  now?: () => number;
  randomId?: () => string;
  report?: (message: string) => void;
  timeoutMs?: number;
}

export interface PublicStagingVerificationResult {
  origin: string;
  checks: number;
  manualChecks: readonly string[];
}

interface RuntimeConfig {
  appUrl: string;
  socketUrl: string;
  socketPath: string;
  turnUrls: string[];
  turnUrl: string;
  turnUsername: string;
  turnExpiresAt: number | null;
  turnCredential: string;
  edition: string;
  billingEnabled: boolean;
  sfuAvailable: boolean;
}

interface SessionCookie {
  name: string;
  pair: string;
  value: string;
  attributes: Map<string, string | true>;
}

interface GuestSession {
  userId: string;
  cookie: SessionCookie;
}

const MANUAL_CHECKS = [
  "Complete real two-device TURN-only calls across separate external networks and capture successful relay candidates with relayProtocol udp and relayProtocol tls.",
  "On those two real devices, exercise microphone, camera, screen sharing, device unplug/replug, and reconnect.",
] as const;

function fail(message: string): never {
  throw new PublicStagingVerificationError(message);
}

function parseBaseUrl(rawBaseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawBaseUrl);
  } catch {
    fail("The staging base URL is invalid. Pass an origin such as https://campfire.example.com.");
  }

  if (parsed.protocol !== "https:") {
    fail("The staging base URL must use HTTPS; HTTP cannot prove production cookie or media security.");
  }
  if (parsed.username || parsed.password) {
    fail("The staging base URL must not contain credentials.");
  }
  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    fail("Pass only the staging origin, without a path, query, or fragment.");
  }
  return new URL(parsed.origin);
}

function endpoint(baseUrl: URL, pathname: string): URL {
  return new URL(pathname, baseUrl);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: URL,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    fail(
      `${label} failed or redirected. Confirm TLS, DNS, reverse-proxy routing, and application availability.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonObject(response: Response, label: string): Promise<Record<string, unknown>> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    fail(`${label} did not return application/json. Check reverse-proxy routing.`);
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BYTES) {
    fail(`${label} returned an unexpectedly large response.`);
  }

  const reader = response.body?.getReader();
  if (!reader) fail(`${label} returned an empty response body.`);

  const decoder = new TextDecoder();
  let body = "";
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_JSON_BYTES) {
      await reader.cancel();
      fail(`${label} returned an unexpectedly large response.`);
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    fail(`${label} returned malformed JSON.`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`${label} returned an unexpected JSON shape.`);
  }
  return parsed as Record<string, unknown>;
}

function requireStatus(response: Response, expected: number, label: string): void {
  if (response.status !== expected) {
    fail(`${label} returned HTTP ${response.status}; expected ${expected}.`);
  }
}

function requireNoStore(response: Response, label: string): void {
  const cacheControl = response.headers.get("cache-control") ?? "";
  if (!/(?:^|,)\s*no-store\b/i.test(cacheControl)) {
    fail(`${label} must send Cache-Control: no-store to prevent stale or credential-bearing responses.`);
  }
}

function requireHsts(response: Response): void {
  const hsts = response.headers.get("strict-transport-security") ?? "";
  const maxAge = /(?:^|;)\s*max-age=(\d+)\b/i.exec(hsts)?.[1];
  if (!maxAge || Number(maxAge) < 86_400) {
    fail(
      "The HTTPS proxy must send Strict-Transport-Security with max-age of at least 86400 seconds.",
    );
  }
}

function stringField(payload: Record<string, unknown>, key: string, label: string): string {
  const value = payload[key];
  if (typeof value !== "string") fail(`${label} field ${key} must be a string.`);
  return value;
}

function stringArrayField(
  payload: Record<string, unknown>,
  key: string,
  label: string,
): string[] {
  const value = payload[key];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    fail(label + " field " + key + " must be an array of strings.");
  }
  return [...value];
}

function booleanField(payload: Record<string, unknown>, key: string, label: string): boolean {
  const value = payload[key];
  if (typeof value !== "boolean") fail(`${label} field ${key} must be a boolean.`);
  return value;
}

function nullableExpiryField(
  payload: Record<string, unknown>,
  key: string,
  label: string,
): number | null {
  const value = payload[key];
  if (
    value !== null &&
    (typeof value !== "number" || !Number.isSafeInteger(value))
  ) {
    fail(`${label} field ${key} must be a safe integer timestamp or null.`);
  }
  return value;
}

function secureSocketEndpoint(raw: string, baseUrl: URL): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail("Runtime config socketUrl is invalid.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "wss:") {
    fail("Runtime config socketUrl must use HTTPS or WSS.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    fail("Runtime config socketUrl must be a credential-free origin without a path, query, or fragment.");
  }
  if (parsed.host !== baseUrl.host) {
    fail(
      "Runtime config socketUrl must use the staging host so the host-only session cookie reaches Socket.IO.",
    );
  }
  return parsed;
}

interface ValidatedTurnUrl {
  scheme: "turn" | "turns";
  transport: "udp" | "tcp" | null;
}

function validateTurnUrls(urls: string[], label: string): ValidatedTurnUrl[] {
  if (urls.length < 1 || urls.length > MAX_TURN_URLS) {
    fail(
      label
        + " turnUrls must contain between 1 and "
        + MAX_TURN_URLS
        + " entries.",
    );
  }
  if (new Set(urls).size !== urls.length) {
    fail(label + " turnUrls must not contain duplicate entries.");
  }

  return urls.map((url, index) => {
    if (url.includes(",")) {
      fail(
        label
          + " turnUrls entry "
          + index
          + " is comma-delimited; each TURN URL must be a separate array entry.",
      );
    }
    try {
      validateTurnUrl(url);
    } catch {
      fail(
        label
          + " turnUrls entry "
          + index
          + " is invalid; expected one turn: or turns: URL with transport=udp|tcp when specified.",
      );
    }

    const scheme = url.startsWith("turns:") ? "turns" : "turn";
    const transportMatch = /\?transport=(udp|tcp)$/.exec(url);
    const transport = (transportMatch?.[1] as "udp" | "tcp" | undefined) ?? null;
    if (scheme === "turns" && transport === "udp") {
      fail(
        label
          + " turnUrls entry "
          + index
          + " uses turns: with transport=udp; secure TURN must use TCP or its secure default.",
      );
    }
    return { scheme, transport };
  });
}

function validateRuntimeConfig(
  payload: Record<string, unknown>,
  baseUrl: URL,
  nowMs: number,
  authenticated: boolean,
): RuntimeConfig {
  const label = authenticated ? "Authenticated runtime config" : "Public runtime config";
  const config: RuntimeConfig = {
    appUrl: stringField(payload, "appUrl", label),
    socketUrl: stringField(payload, "socketUrl", label),
    socketPath: stringField(payload, "socketPath", label),
    turnUrls: stringArrayField(payload, "turnUrls", label),
    turnUrl: stringField(payload, "turnUrl", label),
    turnUsername: stringField(payload, "turnUsername", label),
    turnExpiresAt: nullableExpiryField(payload, "turnExpiresAt", label),
    turnCredential: stringField(payload, "turnCredential", label),
    edition: stringField(payload, "edition", label),
    billingEnabled: booleanField(payload, "billingEnabled", label),
    sfuAvailable: booleanField(payload, "sfuAvailable", label),
  };

  let appUrl: URL;
  try {
    appUrl = new URL(config.appUrl);
  } catch {
    fail(`${label} appUrl is invalid.`);
  }
  if (appUrl.origin !== baseUrl.origin || appUrl.href !== `${baseUrl.origin}/`) {
    fail(`${label} appUrl must exactly match the public HTTPS staging origin.`);
  }
  secureSocketEndpoint(config.socketUrl, baseUrl);
  if (!config.socketPath.startsWith("/") || /[?#]/.test(config.socketPath)) {
    fail(`${label} socketPath must be an absolute path without a query or fragment.`);
  }
  if (config.edition !== "community" || config.billingEnabled) {
    fail("The 0.1 beta staging target must run the Community edition with billing disabled.");
  }

  const turnFields = [
    config.turnUrls.length > 0,
    Boolean(config.turnUrl),
    Boolean(config.turnUsername),
    Boolean(config.turnCredential),
  ];
  if (!authenticated) {
    if (turnFields.some(Boolean) || config.turnExpiresAt !== null) {
      fail("Public runtime config exposed TURN URLs or credentials to an anonymous request.");
    }
  } else {
    if (!turnFields.every(Boolean)) {
      fail(
        "Authenticated runtime config is missing TURN URLs, legacy turnUrl, username, or credential; public internet voice is not launch-ready.",
      );
    }
    const validatedUrls = validateTurnUrls(config.turnUrls, label);
    if (config.turnUrl !== config.turnUrls[0]) {
      fail("Authenticated runtime config legacy turnUrl must match the first turnUrls entry.");
    }
    if (
      !validatedUrls.some(
        ({ scheme, transport }) => scheme === "turn" && transport === "udp",
      )
    ) {
      fail(
        "Authenticated turnUrls must include explicit UDP coverage with turn: and transport=udp.",
      );
    }
    if (
      !validatedUrls.some(
        ({ scheme, transport }) =>
          scheme === "turns" && (transport === null || transport === "tcp"),
      )
    ) {
      fail(
        "Authenticated turnUrls must include secure TURN TLS-over-TCP coverage with turns:.",
      );
    }
    const remainingMs = (config.turnExpiresAt ?? 0) - nowMs;
    if (
      config.turnExpiresAt === null ||
      remainingMs < MIN_TURN_REMAINING_MS ||
      remainingMs > MAX_TURN_REMAINING_MS
    ) {
      fail("Authenticated TURN credentials must have a future bounded expiry; legacy static credentials are not beta-ready.");
    }
  }

  return config;
}

function setCookieValues(headers: Headers): string[] {
  const extended = headers as Headers & { getSetCookie?: () => string[] };
  const values = extended.getSetCookie?.() ?? [];
  if (values.length > 0) return values;
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function parseSetCookie(raw: string): SessionCookie | null {
  const segments = raw.split(";").map((segment) => segment.trim());
  const first = segments.shift() ?? "";
  const equals = first.indexOf("=");
  if (equals <= 0) return null;
  const name = first.slice(0, equals).trim();
  const value = first.slice(equals + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return null;

  const attributes = new Map<string, string | true>();
  for (const segment of segments) {
    if (!segment) continue;
    const attributeEquals = segment.indexOf("=");
    if (attributeEquals === -1) {
      attributes.set(segment.toLowerCase(), true);
    } else {
      attributes.set(
        segment.slice(0, attributeEquals).trim().toLowerCase(),
        segment.slice(attributeEquals + 1).trim(),
      );
    }
  }
  return { name, pair: first, value, attributes };
}

function sessionCookie(headers: Headers): SessionCookie {
  const candidates = setCookieValues(headers)
    .map(parseSetCookie)
    .filter((cookie): cookie is SessionCookie => cookie !== null && cookie.value.length > 0)
    .filter((cookie) => cookie.attributes.has("httponly"));
  if (candidates.length !== 1) {
    fail("Guest authentication must set exactly one non-empty HttpOnly session cookie.");
  }
  return candidates[0];
}

function validateSessionCookie(cookie: SessionCookie): void {
  if (!cookie.attributes.has("secure")) {
    fail("The staging session cookie is missing Secure; verify NODE_ENV=production and HTTPS proxying.");
  }
  if (cookie.attributes.get("samesite")?.toString().toLowerCase() !== "lax") {
    fail("The unified-origin beta session cookie must use SameSite=Lax.");
  }
  if (cookie.attributes.get("path") !== "/") {
    fail("The staging session cookie must use Path=/.");
  }
  if (cookie.attributes.has("domain")) {
    fail("The staging session cookie must remain host-only and must not set Domain.");
  }
  const maxAge = Number(cookie.attributes.get("max-age"));
  if (!Number.isFinite(maxAge) || maxAge <= 0) {
    fail("The staging session cookie must have a positive Max-Age.");
  }
}

function validateClearingCookie(headers: Headers, expectedName: string): void {
  const cookie = setCookieValues(headers)
    .map(parseSetCookie)
    .find((candidate) => candidate?.name === expectedName);
  if (!cookie) fail("Logout did not clear the verifier session cookie.");
  if (
    cookie.value !== "" ||
    cookie.attributes.get("path") !== "/" ||
    !cookie.attributes.has("httponly") ||
    cookie.attributes.get("samesite")?.toString().toLowerCase() !== "lax" ||
    Number(cookie.attributes.get("max-age")) !== 0
  ) {
    fail("Logout returned an invalid session-cookie clearing directive.");
  }
}

export const probeSocketIo: RealtimeProbe = async ({
  endpoint,
  socketPath,
  origin,
  cookie,
  timeoutMs,
}) => {
  const socket = io(endpoint, {
    path: socketPath,
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    timeout: timeoutMs,
    extraHeaders: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: "connected" | "rejected") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.disconnect();
      if (outcome === "connected") resolve();
      else reject(new Error("Realtime connection rejected."));
    };
    const timer = setTimeout(() => finish("rejected"), timeoutMs + 250);
    socket.once("connect", () => finish("connected"));
    socket.once("connect_error", () => finish("rejected"));
  });
};

async function expectRealtimeRejected(
  realtimeProbe: RealtimeProbe,
  input: RealtimeProbeInput,
  acceptedMessage: string,
): Promise<void> {
  try {
    await realtimeProbe(input);
  } catch {
    return;
  }
  fail(acceptedMessage);
}

async function createGuest(
  fetchImpl: typeof fetch,
  baseUrl: URL,
  timeoutMs: number,
  randomId: () => string,
  betaAccessCode: string | undefined,
): Promise<GuestSession> {
  const marker = randomId().replace(/[^0-9A-Za-z]/g, "").slice(0, 12);
  if (!marker) fail("Could not generate a safe verifier guest name.");
  const username = `verify-${marker}`;
  const response = await fetchWithTimeout(
    fetchImpl,
    endpoint(baseUrl, "/api/auth/guest"),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Origin: baseUrl.origin,
      },
      body: JSON.stringify({
        username,
        ...(betaAccessCode ? { betaAccessCode } : {}),
      }),
    },
    timeoutMs,
    "Guest session creation",
  );
  if (response.status === 429) {
    fail("Guest session creation was rate-limited. Wait for the published retry window, then rerun once.");
  }
  if (response.status === 403) {
    fail(
      "Guest session creation was forbidden. If invited-beta access is enabled, set CAMPFIRE_STAGING_BETA_ACCESS_CODE to the current code.",
    );
  }
  requireStatus(response, 201, "Guest session creation");
  const payload = await readJsonObject(response, "Guest session creation");
  const user = payload.user;
  if (!user || typeof user !== "object" || Array.isArray(user)) {
    fail("Guest session creation returned an invalid user payload.");
  }
  const userRecord = user as Record<string, unknown>;
  if (
    typeof userRecord.id !== "string" ||
    typeof userRecord.username !== "string" ||
    !userRecord.username.startsWith(`${username}#`) ||
    userRecord.isGuest !== true
  ) {
    fail("Guest session creation returned an unexpected disposable guest identity.");
  }

  const cookie = sessionCookie(response.headers);
  return { userId: userRecord.id, cookie };
}

async function logoutGuest(
  fetchImpl: typeof fetch,
  baseUrl: URL,
  timeoutMs: number,
  cookie: SessionCookie,
): Promise<void> {
  const response = await fetchWithTimeout(
    fetchImpl,
    endpoint(baseUrl, "/api/auth/logout"),
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Cookie: cookie.pair,
        Origin: baseUrl.origin,
      },
    },
    timeoutMs,
    "Verifier guest logout",
  );
  requireStatus(response, 200, "Verifier guest logout");
  const payload = await readJsonObject(response, "Verifier guest logout");
  if (payload.ok !== true) fail("Verifier guest logout returned an invalid response.");
  validateClearingCookie(response.headers, cookie.name);
}

export async function verifyPublicStaging(
  rawBaseUrl: string,
  options: PublicStagingVerifierOptions = {},
): Promise<PublicStagingVerificationResult> {
  const baseUrl = parseBaseUrl(rawBaseUrl);
  const fetchImpl = options.fetchImpl ?? fetch;
  const realtimeProbe = options.realtimeProbe ?? probeSocketIo;
  const randomId = options.randomId ?? randomUUID;
  const report = options.report ?? (() => undefined);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    fail("Verifier timeout must be between 1000 and 60000 milliseconds.");
  }

  let checks = 0;
  let guest: GuestSession | undefined;
  let primaryFailure: PublicStagingVerificationError | undefined;

  try {
    const healthResponse = await fetchWithTimeout(
      fetchImpl,
      endpoint(baseUrl, "/api/health"),
      { method: "GET", headers: { Accept: "application/json" } },
      timeoutMs,
      "Health check",
    );
    requireStatus(healthResponse, 200, "Health check");
    requireNoStore(healthResponse, "Health check");
    requireHsts(healthResponse);
    const health = await readJsonObject(healthResponse, "Health check");
    if (health.status !== "ok") fail("Health check did not report status ok.");
    report("PASS health, TLS, HSTS, proxy routing, and no-store behavior");
    checks += 1;

    const unauthenticatedMe = await fetchWithTimeout(
      fetchImpl,
      endpoint(baseUrl, "/api/auth/me"),
      { method: "GET", headers: { Accept: "application/json" } },
      timeoutMs,
      "Anonymous session check",
    );
    requireStatus(unauthenticatedMe, 401, "Anonymous session check");
    await readJsonObject(unauthenticatedMe, "Anonymous session check");
    report("PASS anonymous HTTP requests remain unauthenticated");
    checks += 1;

    const publicConfigResponse = await fetchWithTimeout(
      fetchImpl,
      endpoint(baseUrl, "/api/config"),
      { method: "GET", headers: { Accept: "application/json" } },
      timeoutMs,
      "Public runtime config",
    );
    requireStatus(publicConfigResponse, 200, "Public runtime config");
    requireNoStore(publicConfigResponse, "Public runtime config");
    const publicConfig = validateRuntimeConfig(
      await readJsonObject(publicConfigResponse, "Public runtime config"),
      baseUrl,
      now(),
      false,
    );
    report("PASS public runtime config and anonymous TURN secrecy");
    checks += 1;

    guest = await createGuest(
      fetchImpl,
      baseUrl,
      timeoutMs,
      randomId,
      options.betaAccessCode,
    );
    if (guest.userId.startsWith("guest-")) {
      fail(
        "Guest creation used the non-persistent fallback; the database write path is not launch-ready.",
      );
    }
    validateSessionCookie(guest.cookie);
    report("PASS persisted disposable guest and Secure/HttpOnly/SameSite=Lax host-only cookie");
    checks += 1;

    const authenticatedMe = await fetchWithTimeout(
      fetchImpl,
      endpoint(baseUrl, "/api/auth/me"),
      {
        method: "GET",
        headers: { Accept: "application/json", Cookie: guest.cookie.pair },
      },
      timeoutMs,
      "Authenticated session check",
    );
    requireStatus(authenticatedMe, 200, "Authenticated session check");
    const authenticatedIdentity = await readJsonObject(authenticatedMe, "Authenticated session check");
    const authenticatedUser = authenticatedIdentity.user;
    if (
      !authenticatedUser ||
      typeof authenticatedUser !== "object" ||
      Array.isArray(authenticatedUser) ||
      (authenticatedUser as Record<string, unknown>).id !== guest.userId
    ) {
      fail("Authenticated session check returned a different user identity.");
    }
    report("PASS authenticated HTTP session");
    checks += 1;

    const authenticatedConfigResponse = await fetchWithTimeout(
      fetchImpl,
      endpoint(baseUrl, "/api/config"),
      {
        method: "GET",
        headers: { Accept: "application/json", Cookie: guest.cookie.pair },
      },
      timeoutMs,
      "Authenticated runtime config",
    );
    requireStatus(authenticatedConfigResponse, 200, "Authenticated runtime config");
    requireNoStore(authenticatedConfigResponse, "Authenticated runtime config");
    const authenticatedConfig = validateRuntimeConfig(
      await readJsonObject(authenticatedConfigResponse, "Authenticated runtime config"),
      baseUrl,
      now(),
      true,
    );
    if (
      authenticatedConfig.appUrl !== publicConfig.appUrl ||
      authenticatedConfig.socketUrl !== publicConfig.socketUrl ||
      authenticatedConfig.socketPath !== publicConfig.socketPath
    ) {
      fail("Authenticated and public runtime connection settings do not match.");
    }
    report("PASS authenticated ephemeral TURN metadata covers explicit UDP and secure TLS-over-TCP without exposing secrets");
    checks += 1;

    const socketInput = {
      endpoint: authenticatedConfig.socketUrl,
      socketPath: authenticatedConfig.socketPath,
      timeoutMs,
    };
    try {
      await realtimeProbe({
        ...socketInput,
        origin: baseUrl.origin,
        cookie: guest.cookie.pair,
      });
    } catch {
      fail("Allowed-origin authenticated Socket.IO could not connect. Check WebSocket proxying and CORS_ORIGINS.");
    }
    report("PASS allowed-origin authenticated Socket.IO");
    checks += 1;

    await expectRealtimeRejected(
      realtimeProbe,
      {
        ...socketInput,
        origin: HOSTILE_ORIGIN,
        cookie: guest.cookie.pair,
      },
      "Hostile-Origin Socket.IO connected with a valid session; STRICT_CORS/allowRequest is not fail-closed.",
    );
    await expectRealtimeRejected(
      realtimeProbe,
      { ...socketInput, origin: baseUrl.origin },
      "Unauthenticated Socket.IO connected; realtime session enforcement is not fail-closed.",
    );

    try {
      await realtimeProbe({
        ...socketInput,
        origin: baseUrl.origin,
        cookie: guest.cookie.pair,
      });
    } catch {
      fail(
        "Realtime rejection probes were inconclusive because the allowed-origin control reconnect failed.",
      );
    }
    report("PASS hostile-Origin and unauthenticated Socket.IO rejection with live control reconnect");
    checks += 1;
  } catch (error) {
    primaryFailure =
      error instanceof PublicStagingVerificationError
        ? error
        : new PublicStagingVerificationError(
            "The verifier encountered an unexpected failure without exposing response or credential data.",
          );
  } finally {
    if (guest) {
      try {
        await logoutGuest(fetchImpl, baseUrl, timeoutMs, guest.cookie);
        report("PASS verifier guest cookie cleared");
        checks += 1;
      } catch (error) {
        const cleanupFailure =
          error instanceof PublicStagingVerificationError
            ? error
            : new PublicStagingVerificationError("Verifier guest logout failed.");
        primaryFailure = primaryFailure
          ? new PublicStagingVerificationError(
              `${primaryFailure.message} Verifier guest logout also failed; discard the local cookie and let the guest expire.`,
            )
          : cleanupFailure;
      }
    }
  }

  if (primaryFailure) throw primaryFailure;
  return { origin: baseUrl.origin, checks, manualChecks: MANUAL_CHECKS };
}
