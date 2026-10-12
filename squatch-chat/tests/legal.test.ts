import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fillLegalPlaceholders,
  legalConfigurationWarnings,
  legalPagesEnabled,
  legalPlaceholdersRemaining,
} from "@/lib/legal";
import { parseInline, parseLegalMarkdown } from "@/lib/legalMarkdown";
import { TERMS_MARKDOWN } from "@/app/terms/terms";
import { PRIVACY_MARKDOWN } from "@/app/privacy/privacy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Terms and Privacy pages", () => {
  it("exist only on Campfire Online, never on a self-hosted (community) server", () => {
    vi.stubEnv("SELF_HOSTED", "");
    vi.stubEnv("CAMPFIRE_EDITION", "cloud");
    expect(legalPagesEnabled()).toBe(true);
    vi.stubEnv("CAMPFIRE_EDITION", "community");
    expect(legalPagesEnabled()).toBe(false);
    vi.stubEnv("CAMPFIRE_EDITION", "");
    expect(legalPagesEnabled()).toBe(false);
  });

  it.each([
    ["terms", TERMS_MARKDOWN],
    ["privacy", PRIVACY_MARKDOWN],
  ])("%s fills every placeholder from lib/legal.ts and parses cleanly", (_, markdown) => {
    const filled = fillLegalPlaceholders(markdown);
    expect(filled).not.toMatch(/\{\{|\}\}|<!--|Owner notes/);

    const blocks = parseLegalMarkdown(filled);
    expect(blocks.filter((block) => block.type === "heading" && block.level === 1)).toHaveLength(1);
    const ids = blocks.flatMap((block) => (block.type === "heading" ? [block.id] : []));
    expect(new Set(ids).size).toBe(ids.length);
    for (const block of blocks) {
      if (block.type === "table") {
        for (const row of block.rows) expect(row).toHaveLength(block.header.length);
      }
    }
  });

  it("warns at startup on Campfire Online only, including when billing contradicts Terms section 13", () => {
    vi.stubEnv("SELF_HOSTED", "");
    vi.stubEnv("CAMPFIRE_EDITION", "community");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_x");
    vi.stubEnv("STRIPE_PRICE_MONTHLY", "price_m");
    vi.stubEnv("STRIPE_PRICE_YEARLY", "price_y");
    expect(legalConfigurationWarnings()).toEqual([]);

    vi.stubEnv("CAMPFIRE_EDITION", "cloud");
    const withBilling = legalConfigurationWarnings();
    expect(withBilling.some((warning) => warning.includes("Terms section 13"))).toBe(true);
    expect(withBilling.some((warning) => warning.includes("EU_REPRESENTATIVE"))).toBe(true);

    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(legalConfigurationWarnings().some((warning) => warning.includes("Terms section 13"))).toBe(false);
  });

  it("rejects an unknown placeholder and reports unfilled owner values by name", () => {
    expect(() => fillLegalPlaceholders("{{NOT_A_CONSTANT}}")).toThrow(/NOT_A_CONSTANT/);
    for (const name of legalPlaceholdersRemaining()) {
      expect(fillLegalPlaceholders(`{{${name}}}`)).toMatch(/^\[.+\]$/);
    }
  });

  it("parses inline bold, code, links, autolinks, and email addresses", () => {
    expect(parseInline("**Hi** `x` [Terms](/terms) <https://a.example/b> or me@a.example.")).toEqual([
      { type: "strong", children: [{ type: "text", text: "Hi" }] },
      { type: "text", text: " " },
      { type: "code", text: "x" },
      { type: "text", text: " " },
      { type: "link", href: "/terms", children: [{ type: "text", text: "Terms" }] },
      { type: "text", text: " " },
      { type: "link", href: "https://a.example/b", children: [{ type: "text", text: "https://a.example/b" }] },
      { type: "text", text: " or " },
      { type: "link", href: "mailto:me@a.example", children: [{ type: "text", text: "me@a.example" }] },
      { type: "text", text: "." },
    ]);
  });
});
