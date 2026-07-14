import { afterEach, describe, expect, it, vi } from "vitest";
import {
  billingConfiguration,
  getEdition,
  validateEditionConfig,
} from "@/lib/edition";
import { getFeatures, getTier, hasFeature } from "@/lib/features";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Campfire edition policy", () => {
  it("defaults safely to Community and rejects unknown editions", () => {
    expect(getEdition({})).toBe("community");
    expect(getEdition({ CAMPFIRE_EDITION: "COMMUNITY" })).toBe("community");
    expect(getEdition({ CAMPFIRE_EDITION: "cloud" })).toBe("cloud");
    expect(() => getEdition({ CAMPFIRE_EDITION: "enterprise" })).toThrow(
      /community.*cloud/i,
    );
  });

  it("keeps legacy SELF_HOSTED=true pinned to Community", () => {
    expect(
      getEdition({ SELF_HOSTED: "true", CAMPFIRE_EDITION: "cloud" }),
    ).toBe("community");
  });

  it("only enables billing for a fully configured Cloud edition", () => {
    const complete = {
      CAMPFIRE_EDITION: "cloud",
      STRIPE_SECRET_KEY: "sk_test_value",
      STRIPE_WEBHOOK_SECRET: "whsec_value",
      STRIPE_PRICE_MONTHLY: "price_monthly",
      STRIPE_PRICE_YEARLY: "price_yearly",
    };

    expect(billingConfiguration(complete)).toMatchObject({
      edition: "cloud",
      enabled: true,
      missing: [],
    });
    expect(
      billingConfiguration({ ...complete, CAMPFIRE_EDITION: "community" }),
    ).toMatchObject({ edition: "community", enabled: false });
    expect(
      billingConfiguration({ ...complete, STRIPE_PRICE_YEARLY: "" }),
    ).toMatchObject({ enabled: false, missing: ["STRIPE_PRICE_YEARLY"] });
  });

  it("fails closed on unsafe production Cloud configuration", () => {
    const result = validateEditionConfig({
      CAMPFIRE_EDITION: "cloud",
      NODE_ENV: "production",
      DATABASE_URL: "file:./campfire.db",
      JWT_SECRET: "change-me",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      STRICT_CORS: "false",
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/PostgreSQL/),
        expect.stringMatching(/JWT_SECRET/),
        expect.stringMatching(/HTTPS/),
        expect.stringMatching(/RESEND_API_KEY/),
        expect.stringMatching(/CAMPFIRE_EMAIL_FROM/),
        expect.stringMatching(/STRICT_CORS/),
      ]),
    );
  });

  it("accepts the required production Cloud safety settings", () => {
    const result = validateEditionConfig({
      CAMPFIRE_EDITION: "cloud",
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://campfire:test@db.local/campfire",
      JWT_SECRET: "a-unique-production-secret-with-32-characters",
      NEXT_PUBLIC_APP_URL: "https://campfire.example",
      RESEND_API_KEY: "re_live_value",
      CAMPFIRE_EMAIL_FROM: "Campfire <account@campfire.example>",
      STRICT_CORS: "true",
      CORS_ORIGINS: "https://campfire.example",
      STRIPE_SECRET_KEY: "sk_live_value",
      STRIPE_WEBHOOK_SECRET: "whsec_value",
      STRIPE_PRICE_MONTHLY: "price_monthly",
      STRIPE_PRICE_YEARLY: "price_yearly",
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

describe("edition-aware feature gates", () => {
  it("unlocks shipped code in Community but never unlocks planned features", () => {
    vi.stubEnv("CAMPFIRE_EDITION", "community");
    vi.stubEnv("SELF_HOSTED", "false");

    expect(hasFeature("free", "custom_emoji")).toBe(true);
    expect(hasFeature("self-hosted", "extended_upload")).toBe(true);
    expect(hasFeature("self-hosted", "two_factor_auth")).toBe(false);
    expect(getTier({ tier: "premium" })).toBe("self-hosted");
  });

  it("enforces free and premium tiers in Cloud", () => {
    vi.stubEnv("CAMPFIRE_EDITION", "cloud");
    vi.stubEnv("SELF_HOSTED", "false");

    expect(hasFeature("free", "core_chat")).toBe(true);
    expect(hasFeature("free", "custom_emoji")).toBe(false);
    expect(hasFeature("premium", "custom_emoji")).toBe(true);
    expect(hasFeature("premium", "two_factor_auth")).toBe(false);
    expect(getFeatures("premium")).toContain("scheduled_messages");
    expect(getFeatures("premium")).not.toContain("sso_oauth");
  });

  it("downgrades expired Cloud subscriptions at read time", () => {
    vi.stubEnv("CAMPFIRE_EDITION", "cloud");
    vi.stubEnv("SELF_HOSTED", "false");

    expect(
      getTier({ tier: "premium", tierExpiresAt: new Date(Date.now() - 1_000) }),
    ).toBe("free");
    expect(
      getTier({ tier: "premium", tierExpiresAt: new Date(Date.now() + 60_000) }),
    ).toBe("premium");
  });
});
