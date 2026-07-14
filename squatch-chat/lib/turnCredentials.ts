import { createHmac } from "node:crypto";
import { isIP } from "node:net";

export const DEFAULT_TURN_CREDENTIAL_TTL_SECONDS = 15 * 60;
export const MIN_TURN_CREDENTIAL_TTL_SECONDS = 60;
export const MAX_TURN_CREDENTIAL_TTL_SECONDS = 60 * 60;
export const MAX_TURN_CREDENTIAL_BUCKET_SECONDS = 5 * 60;
export const MIN_TURN_AUTH_SECRET_LENGTH = 32;
export const MAX_TURN_URLS = 8;

export interface TurnEnvironment {
  NODE_ENV?: string;
  TURN_URLS?: string;
  TURN_URL?: string;
  TURN_AUTH_SECRET?: string;
  TURN_CREDENTIAL_TTL_SECONDS?: string;
  TURN_ALLOW_LEGACY_STATIC_CREDENTIALS?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;
}

export type TurnConfiguration =
  | { mode: "disabled" }
  | {
    mode: "ephemeral";
    urls: string[];
    authSecret: string;
    ttlSeconds: number;
  }
  | {
    mode: "legacy";
    urls: string[];
    username: string;
    credential: string;
  };

export interface TurnCredentials {
  username: string;
  credential: string;
  expiresAt: number;
}

export function resolveTurnCredentialTtlSeconds(rawTtl: string | undefined): number {
  const parsed = Number.parseInt(rawTtl || "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TURN_CREDENTIAL_TTL_SECONDS;
  return Math.min(
    MAX_TURN_CREDENTIAL_TTL_SECONDS,
    Math.max(MIN_TURN_CREDENTIAL_TTL_SECONDS, parsed),
  );
}

const TURN_URI_PATTERN =
  /^(turns?):(\[[^\]]+\]|[^:?#[\]/@]+)(?::([0-9]+))?(?:\?transport=(udp|tcp))?$/;

function validHostname(host: string): boolean {
  if (host.length > 253) return false;
  if (/^[0-9.]+$/.test(host)) return isIP(host) === 4;
  return host.split(".").every((label) =>
    label.length > 0
    && label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  );
}

export function validateTurnUrl(url: string): string {
  if (!url || /\s/.test(url)) {
    throw new Error("TURN URLs must be non-empty and contain no whitespace.");
  }
  const match = TURN_URI_PATTERN.exec(url);
  if (!match) {
    throw new Error(
      `Invalid TURN URL "${url}". Expected turn: or turns: with an optional port and transport=udp|tcp.`,
    );
  }

  if (match[1] === "turns" && match[4] === "udp") {
    throw new Error(`Invalid secure TURN transport in "${url}"; turns: requires TCP.`);
  }

  const host = match[2];
  if (host.startsWith("[")) {
    if (isIP(host.slice(1, -1)) !== 6) {
      throw new Error(`Invalid TURN URL host in "${url}".`);
    }
  } else if (isIP(host) === 0 && !validHostname(host)) {
    throw new Error(`Invalid TURN URL host in "${url}".`);
  }

  if (match[3]) {
    const port = Number(match[3]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`Invalid TURN URL port in "${url}".`);
    }
  }

  return url;
}

export function resolveTurnUrls(env: TurnEnvironment = process.env): string[] {
  const serializedUrls = env.TURN_URLS;
  if (serializedUrls?.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedUrls);
    } catch {
      throw new Error("TURN_URLS must be valid JSON.");
    }
    if (!Array.isArray(parsed)) {
      throw new Error("TURN_URLS must be a JSON array.");
    }
    if (parsed.length < 1 || parsed.length > MAX_TURN_URLS) {
      throw new Error(`TURN_URLS must contain between 1 and ${MAX_TURN_URLS} entries.`);
    }
    if (!parsed.every((value): value is string => typeof value === "string")) {
      throw new Error("Every TURN_URLS entry must be a string.");
    }
    const urls = parsed.map(validateTurnUrl);
    if (new Set(urls).size !== urls.length) {
      throw new Error("TURN_URLS entries must be unique.");
    }
    return urls;
  }

  if (env.TURN_URL?.trim()) return [validateTurnUrl(env.TURN_URL)];
  return [];
}

export function assertTurnConfiguration(
  env: TurnEnvironment = process.env,
): TurnConfiguration {
  const urls = resolveTurnUrls(env);
  const authSecret = env.TURN_AUTH_SECRET || "";
  const legacySetting = env.TURN_ALLOW_LEGACY_STATIC_CREDENTIALS || "";
  const legacyEnabled = legacySetting === "1";
  const username = env.TURN_USERNAME || "";
  const credential = env.TURN_CREDENTIAL || "";

  if (legacySetting && legacySetting !== "0" && legacySetting !== "1") {
    throw new Error("TURN_ALLOW_LEGACY_STATIC_CREDENTIALS must be 0 or 1.");
  }

  if (urls.length > 0 && authSecret) {
    if (authSecret.trim().length < MIN_TURN_AUTH_SECRET_LENGTH) {
      throw new Error(
        `TURN_AUTH_SECRET must contain at least ${MIN_TURN_AUTH_SECRET_LENGTH} characters of random data.`,
      );
    }
    return {
      mode: "ephemeral",
      urls,
      authSecret,
      ttlSeconds: resolveTurnCredentialTtlSeconds(env.TURN_CREDENTIAL_TTL_SECONDS),
    };
  }

  if (legacyEnabled) {
    if (urls.length === 0 || !username || !credential) {
      throw new Error(
        "Legacy TURN mode requires TURN_URLS or TURN_URL, TURN_USERNAME, and TURN_CREDENTIAL.",
      );
    }
    return { mode: "legacy", urls, username, credential };
  }

  const hasPartialConfiguration = Boolean(
    urls.length > 0
    || authSecret
    || env.TURN_CREDENTIAL_TTL_SECONDS
    || username
    || credential,
  );
  if (env.NODE_ENV === "production" && hasPartialConfiguration) {
    throw new Error(
      "Incomplete TURN configuration. Set TURN_URLS or TURN_URL with a strong TURN_AUTH_SECRET, "
      + "or explicitly enable the complete legacy static credential mode.",
    );
  }

  return { mode: "disabled" };
}

/**
 * Mint a coturn TURN REST credential. The shared secret remains server-only;
 * browsers receive only this time-bound username and its HMAC.
 */
export function mintTurnCredentials(
  authSecret: string,
  userId: string,
  options: { nowMs?: number; ttlSeconds?: number } = {},
): TurnCredentials {
  if (authSecret.trim().length < MIN_TURN_AUTH_SECRET_LENGTH) {
    throw new Error(
      `TURN_AUTH_SECRET must contain at least ${MIN_TURN_AUTH_SECRET_LENGTH} characters of random data.`,
    );
  }
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const ttlSeconds = Math.min(
    MAX_TURN_CREDENTIAL_TTL_SECONDS,
    Math.max(
      MIN_TURN_CREDENTIAL_TTL_SECONDS,
      options.ttlSeconds ?? DEFAULT_TURN_CREDENTIAL_TTL_SECONDS,
    ),
  );
  // Stable expiry buckets prevent repeated config requests for one account
  // from continuously minting new coturn usernames and bypassing user-quota.
  const bucketSeconds = Math.min(
    MAX_TURN_CREDENTIAL_BUCKET_SECONDS,
    Math.max(1, Math.floor(ttlSeconds / 4)),
  );
  const expiryUnix = Math.floor((nowSeconds + ttlSeconds) / bucketSeconds) * bucketSeconds;
  const username = `${expiryUnix}:${userId}`;

  return {
    username,
    credential: createHmac("sha1", authSecret).update(username).digest("base64"),
    expiresAt: expiryUnix * 1000,
  };
}
