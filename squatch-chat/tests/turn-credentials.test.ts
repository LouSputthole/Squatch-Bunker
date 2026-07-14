import { describe, expect, it } from "vitest";
import {
  DEFAULT_TURN_CREDENTIAL_TTL_SECONDS,
  MAX_TURN_CREDENTIAL_TTL_SECONDS,
  MAX_TURN_URLS,
  MIN_TURN_CREDENTIAL_TTL_SECONDS,
  assertTurnConfiguration,
  mintTurnCredentials,
  resolveTurnCredentialTtlSeconds,
  resolveTurnUrls,
  validateTurnUrl,
} from "@/lib/turnCredentials";

const STRONG_SECRET = "test-turn-secret-0123456789abcdef";
const NOW_MS = 1_700_000_000_000;
const TURN_URLS = [
  "turn:turn.campfire.test:3478?transport=udp",
  "turn:turn.campfire.test:3478?transport=tcp",
  "turns:turn.campfire.test:5349?transport=tcp",
];

describe("coturn REST credentials", () => {
  it("mints the expected bucketed HMAC-SHA1 credential", () => {
    expect(mintTurnCredentials(STRONG_SECRET, "user_123", {
      nowMs: NOW_MS,
      ttlSeconds: 900,
    })).toEqual({
      username: "1700000775:user_123",
      credential: "MqFOZ088BLRBxhOJklVxXen+zmg=",
      expiresAt: 1_700_000_775_000,
    });
  });

  it("keeps one user's credential stable within a bucket and rolls over afterward", () => {
    const first = mintTurnCredentials(STRONG_SECRET, "user_123", {
      nowMs: NOW_MS,
      ttlSeconds: 900,
    });
    const sameBucket = mintTurnCredentials(STRONG_SECRET, "user_123", {
      nowMs: NOW_MS + 1_000,
      ttlSeconds: 900,
    });
    const nextBucket = mintTurnCredentials(STRONG_SECRET, "user_123", {
      nowMs: NOW_MS + 225_000,
      ttlSeconds: 900,
    });

    expect(sameBucket).toEqual(first);
    expect(nextBucket.username).toBe("1700001000:user_123");
    expect(nextBucket.credential).not.toBe(first.credential);
  });

  it("rejects weak shared secrets", () => {
    expect(() => mintTurnCredentials("too-short", "user_123"))
      .toThrow("at least 32 characters");
  });

  it("uses a safe default and clamps configured TTLs", () => {
    expect(resolveTurnCredentialTtlSeconds(undefined))
      .toBe(DEFAULT_TURN_CREDENTIAL_TTL_SECONDS);
    expect(resolveTurnCredentialTtlSeconds("not-a-number"))
      .toBe(DEFAULT_TURN_CREDENTIAL_TTL_SECONDS);
    expect(resolveTurnCredentialTtlSeconds("1"))
      .toBe(MIN_TURN_CREDENTIAL_TTL_SECONDS);
    expect(resolveTurnCredentialTtlSeconds("999999"))
      .toBe(MAX_TURN_CREDENTIAL_TTL_SECONDS);
  });
});

describe("TURN URL configuration", () => {
  it("accepts safe TURN URI forms", () => {
    const validUrls = [
      "turn:turn.campfire.test",
      "turn:192.0.2.10:3478?transport=udp",
      "turn:[2001:db8::1]:3478?transport=tcp",
      "turns:turn.campfire.test:5349?transport=tcp",
    ];

    for (const url of validUrls) {
      expect(validateTurnUrl(url)).toBe(url);
    }
  });

  it("prefers a non-empty TURN_URLS JSON array and keeps TURN_URL as a fallback", () => {
    expect(resolveTurnUrls({
      TURN_URLS: JSON.stringify(TURN_URLS),
      TURN_URL: "turn:fallback.campfire.test:3478",
    })).toEqual(TURN_URLS);

    expect(resolveTurnUrls({
      TURN_URLS: "",
      TURN_URL: "turn:fallback.campfire.test:3478",
    })).toEqual(["turn:fallback.campfire.test:3478"]);
  });

  it.each([
    ["malformed JSON", "{not-json"],
    ["a JSON scalar", JSON.stringify("turn:turn.campfire.test:3478")],
    ["an empty array", "[]"],
    ["a non-string entry", JSON.stringify(["turn:turn.campfire.test:3478", 3478])],
    ["duplicate entries", JSON.stringify([
      "turn:turn.campfire.test:3478",
      "turn:turn.campfire.test:3478",
    ])],
    ["too many entries", JSON.stringify(Array.from(
      { length: MAX_TURN_URLS + 1 },
      (_, index) => `turn:turn${index}.campfire.test:3478`,
    ))],
  ])("rejects %s in TURN_URLS", (_label, value) => {
    expect(() => resolveTurnUrls({
      TURN_URLS: value,
      TURN_URL: "turn:fallback.campfire.test:3478",
    })).toThrow();
  });

  it.each([
    "stun:stun.campfire.test:3478",
    "http://turn.campfire.test:3478",
    "turn:",
    "turn://turn.campfire.test:3478",
    "turn:user@turn.campfire.test:3478",
    "turn:turn.campfire.test:3478#fragment",
    "turn:turn.campfire.test:3478/path",
    "turn:turn.campfire.test:3478?transport=tls",
    "turns:turn.campfire.test:5349?transport=udp",
    "turn:turn.campfire.test:3478?transport=udp&extra=1",
    "turn:turn.campfire.test:0",
    "turn:turn.campfire.test:65536",
    "turn:999.999.999.999:3478",
    "turn:[not-ipv6]:3478",
    "turn:turn host.campfire.test:3478",
    "turn:one.campfire.test:3478,turn:two.campfire.test:3478",
  ])("rejects an unsafe or malformed URL: %s", (url) => {
    expect(() => validateTurnUrl(url)).toThrow();
  });
});

describe("TURN deployment configuration", () => {
  it("resolves a strong ephemeral configuration with every configured URL", () => {
    expect(assertTurnConfiguration({
      NODE_ENV: "production",
      TURN_URLS: JSON.stringify(TURN_URLS),
      TURN_URL: "turn:fallback.campfire.test:3478",
      TURN_AUTH_SECRET: STRONG_SECRET,
      TURN_CREDENTIAL_TTL_SECONDS: "900",
    })).toEqual({
      mode: "ephemeral",
      urls: TURN_URLS,
      authSecret: STRONG_SECRET,
      ttlSeconds: 900,
    });
  });

  it("fails production startup for partial or insecure configuration", () => {
    expect(() => assertTurnConfiguration({
      NODE_ENV: "production",
      TURN_URL: "turns:turn.campfire.test:5349",
    })).toThrow("Incomplete TURN configuration");

    expect(() => assertTurnConfiguration({
      NODE_ENV: "production",
      TURN_URL: "turns:turn.campfire.test:5349",
      TURN_AUTH_SECRET: "too-short",
    })).toThrow("at least 32 characters");

    expect(() => assertTurnConfiguration({
      NODE_ENV: "production",
      TURN_AUTH_SECRET: STRONG_SECRET,
    })).toThrow("Incomplete TURN configuration");
  });

  it("allows disabled TURN or an explicitly complete legacy compatibility mode", () => {
    expect(assertTurnConfiguration({ NODE_ENV: "production" }))
      .toEqual({ mode: "disabled" });
    expect(assertTurnConfiguration({
      NODE_ENV: "production",
      TURN_CREDENTIAL_TTL_SECONDS: "",
    })).toEqual({ mode: "disabled" });

    expect(assertTurnConfiguration({
      NODE_ENV: "production",
      TURN_URL: "turn:turn.campfire.test:3478",
      TURN_ALLOW_LEGACY_STATIC_CREDENTIALS: "1",
      TURN_USERNAME: "legacy-user",
      TURN_CREDENTIAL: "legacy-password",
    })).toEqual({
      mode: "legacy",
      urls: ["turn:turn.campfire.test:3478"],
      username: "legacy-user",
      credential: "legacy-password",
    });
  });
});
