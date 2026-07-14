import { describe, expect, it } from "vitest";
import {
  createOriginPolicy,
  isPrivateLanOrigin,
  isStrictCorsEnabled,
} from "@/lib/originPolicy";

describe("realtime origin policy", () => {
  it("treats only the explicit true value as strict CORS", () => {
    expect(isStrictCorsEnabled("true")).toBe(true);
    expect(isStrictCorsEnabled(" TRUE ")).toBe(true);
    expect(isStrictCorsEnabled("false")).toBe(false);
    expect(isStrictCorsEnabled(undefined)).toBe(false);
  });

  it("keeps default and STRICT_CORS=false self-hosting on private origins", () => {
    for (const strictCors of [undefined, "false"]) {
      const policy = createOriginPolicy({ strictCors });
      expect(policy.selfHosted).toBe(true);
      expect(policy.isOriginAllowed("http://localhost:3000")).toBe(true);
      expect(policy.isOriginAllowed("http://192.168.1.20:3000")).toBe(true);
      expect(policy.isOriginAllowed("https://10.0.0.5")).toBe(true);
      expect(policy.isOriginAllowed("https://public.example")).toBe(false);
    }
  });

  it("restricts strict deployments to their exact allowlist", () => {
    const policy = createOriginPolicy({
      strictCors: "true",
      corsOrigins: "https://campfire.example/, https://www.campfire.example/realtime",
    });

    expect(policy.selfHosted).toBe(false);
    expect(policy.isOriginAllowed("https://campfire.example")).toBe(true);
    expect(policy.isOriginAllowed("https://www.campfire.example")).toBe(true);
    expect(policy.isOriginAllowed("http://192.168.1.20:3000")).toBe(false);
    expect(policy.isOriginAllowed("https://evil.example")).toBe(false);
    expect(policy.isOriginAllowed(undefined)).toBe(true);
  });

  it("fails closed when a configured allowlist origin is malformed", () => {
    expect(() =>
      createOriginPolicy({ strictCors: "true", corsOrigins: "not an origin" }),
    ).toThrow(/Invalid CORS origin/);
    expect(() =>
      createOriginPolicy({ strictCors: "true", corsOrigins: "ftp://example" }),
    ).toThrow(/Invalid CORS origin/);
  });

  it("uses an explicit allowlist even when strict mode is false", () => {
    const policy = createOriginPolicy({
      strictCors: "false",
      corsOrigins: "https://campfire.example",
    });

    expect(policy.selfHosted).toBe(false);
    expect(policy.isOriginAllowed("https://campfire.example")).toBe(true);
    expect(policy.isOriginAllowed("http://10.0.0.4:3000")).toBe(false);
  });

  it("recognizes supported LAN ranges and rejects malformed/public origins", () => {
    expect(isPrivateLanOrigin("http://172.16.0.1:3000")).toBe(true);
    expect(isPrivateLanOrigin("http://172.31.255.255:3000")).toBe(true);
    expect(isPrivateLanOrigin("http://[::1]:3000")).toBe(true);
    expect(isPrivateLanOrigin("http://172.32.0.1:3000")).toBe(false);
    expect(isPrivateLanOrigin("https://8.8.8.8")).toBe(false);
    expect(isPrivateLanOrigin("https://10.evil.example")).toBe(false);
    expect(isPrivateLanOrigin("https://192.168.evil.example")).toBe(false);
    expect(isPrivateLanOrigin("https://172.16.evil.example")).toBe(false);
    expect(isPrivateLanOrigin("not an origin")).toBe(false);
  });
});
