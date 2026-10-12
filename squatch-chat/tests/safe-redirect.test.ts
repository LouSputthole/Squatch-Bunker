import { describe, expect, it } from "vitest";
import { safeRedirectTarget } from "@/lib/safeRedirect";

const origin = "https://camp.example";
const go = (redirect: string) => safeRedirectTarget(`?redirect=${encodeURIComponent(redirect)}`, origin);

describe("safeRedirectTarget", () => {
  it("keeps same-origin paths with query", () => {
    expect(go("/join/abc123")).toBe("/join/abc123");
    expect(go("/chat?s=1&c=2")).toBe("/chat?s=1&c=2");
  });

  it("rejects off-origin and smuggled targets", () => {
    const bad = [
      "https://evil.com",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "\n//evil.com",
      "javascript:alert(1)",
      "/.//evil.com",
      "/..//evil.com",
    ];
    for (const target of bad) expect(go(target)).toBe("/chat");
    expect(safeRedirectTarget("", origin)).toBe("/chat");
  });
});
