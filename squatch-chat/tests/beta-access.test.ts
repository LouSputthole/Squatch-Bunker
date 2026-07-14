import { describe, expect, it } from "vitest";
import {
  assertBetaAccessConfig,
  betaAccessAllowed,
  betaAccessRequired,
} from "@/lib/betaAccess";

describe("invited beta access policy", () => {
  it("keeps self-hosted registration open when no code is configured", () => {
    const env = {};

    expect(betaAccessRequired(env)).toBe(false);
    expect(betaAccessAllowed(undefined, env)).toBe(true);
    expect(betaAccessAllowed("anything", env)).toBe(true);
  });

  it("requires an exact code without leaking it through validation", () => {
    const code = "beta-access-code-0123456789";
    const env = { CAMPFIRE_BETA_ACCESS_CODE: code };

    expect(betaAccessRequired(env)).toBe(true);
    expect(betaAccessAllowed(undefined, env)).toBe(false);
    expect(betaAccessAllowed(7, env)).toBe(false);
    expect(betaAccessAllowed("wrong-code", env)).toBe(false);
    expect(betaAccessAllowed(code, env)).toBe(true);
  });

  it("rejects weak codes and OAuth combinations at startup", () => {
    expect(() =>
      assertBetaAccessConfig({ CAMPFIRE_BETA_ACCESS_CODE: "too-short" }),
    ).toThrow("at least 16 characters");

    expect(() =>
      assertBetaAccessConfig({
        CAMPFIRE_BETA_ACCESS_CODE: "beta-access-code-0123456789",
        GITHUB_CLIENT_ID: "configured",
      }),
    ).toThrow("cannot be combined with OAuth providers");
  });
});
