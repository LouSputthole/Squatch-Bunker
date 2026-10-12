import { afterEach, describe, expect, it, vi } from "vitest";

async function productionConfig(cookieSecure?: string) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  if (cookieSecure !== undefined) vi.stubEnv("COOKIE_SECURE", cookieSecure);
  return (await import("@/lib/config")).config;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("session cookie Secure flag", () => {
  it("is Secure in production by default", async () => {
    expect((await productionConfig()).cookieScopeFlags).toContain("Secure");
  });

  it("COOKIE_SECURE=0 drops Secure for plain-HTTP LAN/desktop hosting", async () => {
    const flags = (await productionConfig("0")).cookieScopeFlags;
    expect(flags).not.toContain("Secure");
    expect(flags).toContain("SameSite=Lax");
  });

  it("COOKIE_SECURE=1 keeps the cross-origin HTTPS behaviour", async () => {
    const flags = (await productionConfig("1")).cookieScopeFlags;
    expect(flags).toContain("Secure");
    expect(flags).toContain("SameSite=None");
  });
});
