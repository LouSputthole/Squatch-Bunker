import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/notice/route";
import { currentNotice } from "@/lib/notice";

// CAMPFIRE_NOTICE parsing (lib/notice.ts) and the public GET /api/notice that
// components/NoticeBanner reads. Pure env, no database.

const PRO_NOTICE = {
  id: "pro-launch-1",
  text: "  Campfire Pro is here.  ",
  url: "https://campfire.example/pro",
  urlLabel: " See Pro ",
};

beforeEach(() => {
  // Reset the module cache to "no notice" so each test starts clean.
  currentNotice({});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("currentNotice", () => {
  it("is null when unset or blank, without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(currentNotice({})).toBeNull();
    expect(currentNotice({ CAMPFIRE_NOTICE: "   " })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("parses a valid notice through the shared contract", () => {
    expect(currentNotice({ CAMPFIRE_NOTICE: JSON.stringify(PRO_NOTICE) })).toEqual({
      id: "pro-launch-1",
      text: "Campfire Pro is here.",
      url: "https://campfire.example/pro",
      urlLabel: "See Pro",
    });
    expect(currentNotice({ CAMPFIRE_NOTICE: JSON.stringify({ id: "v2", text: "Update to 0.2" }) })).toEqual({
      id: "v2",
      text: "Update to 0.2",
      url: null,
      urlLabel: null,
    });
  });

  it("treats invalid JSON or an invalid notice as none and warns once per value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (let i = 0; i < 3; i++) expect(currentNotice({ CAMPFIRE_NOTICE: "{not json" })).toBeNull();
    expect(warn).toHaveBeenCalledOnce();

    const plainHttp = JSON.stringify({ ...PRO_NOTICE, url: "http://campfire.example/pro" });
    expect(currentNotice({ CAMPFIRE_NOTICE: plainHttp })).toBeNull();
    expect(currentNotice({ CAMPFIRE_NOTICE: JSON.stringify({ id: "has spaces", text: "x" }) })).toBeNull();
    expect(currentNotice({ CAMPFIRE_NOTICE: JSON.stringify(["not", "an", "object"]) })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("picks up a changed value", () => {
    expect(currentNotice({ CAMPFIRE_NOTICE: JSON.stringify({ id: "a", text: "First" }) })?.id).toBe("a");
    expect(currentNotice({ CAMPFIRE_NOTICE: JSON.stringify({ id: "b", text: "Second" }) })?.id).toBe("b");
    expect(currentNotice({})).toBeNull();
  });
});

describe("GET /api/notice", () => {
  it("answers {notice: null} when none is set", async () => {
    vi.stubEnv("CAMPFIRE_NOTICE", "");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ notice: null });
  });

  it("answers the parsed notice when one is set", async () => {
    vi.stubEnv("CAMPFIRE_NOTICE", JSON.stringify(PRO_NOTICE));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      notice: { id: "pro-launch-1", text: "Campfire Pro is here.", url: "https://campfire.example/pro", urlLabel: "See Pro" },
    });
  });

  it("hides an invalid notice", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("CAMPFIRE_NOTICE", JSON.stringify({ ...PRO_NOTICE, url: "javascript:alert(1)" }));
    expect(await (await GET()).json()).toEqual({ notice: null });
  });
});

describe("NoticeBanner", () => {
  it("re-reads the notice for chat sessions that stay open for days, and cleans up", () => {
    const source = readFileSync(resolve(process.cwd(), "components/NoticeBanner.tsx"), "utf8");
    expect(source).toContain('document.addEventListener("visibilitychange", recheck)');
    expect(source).toContain('document.removeEventListener("visibilitychange", recheck)');
    expect(source).toMatch(/const timer = setInterval\(recheck, /);
    expect(source).toContain("clearInterval(timer)");
  });
});
