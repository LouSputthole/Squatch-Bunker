import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TELEMETRY_PING_PATH as DESKTOP_PING_PATH,
  buildDesktopPing,
  defaultMode,
  isPrerelease,
  noticeFromPingResponse,
  parseCloudOrigin,
  parseTelemetryNotice as parseDesktopNotice,
  rememberNotice,
  sameVersion,
  shouldShowNotice,
  telemetryEnabled,
  telemetryTarget,
  updateFeedOverride,
  updateMode,
} from "@/desktop/launcher-core.cjs";
import { TELEMETRY_PING_PATH, parseTelemetryNotice, parseTelemetryPing } from "@/lib/telemetryProtocol";

const CLOUD = "https://campfire.example";
const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "campfire-launcher-"));
  temporaryDirectories.push(directory);
  return directory;
}

function touch(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, "");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("parseCloudOrigin", () => {
  it("accepts https and normalizes to the origin", () => {
    expect(parseCloudOrigin("https://campfire.example")).toBe(CLOUD);
    expect(parseCloudOrigin("  https://Campfire.Example:443/chat?x=1  ")).toBe(CLOUD);
    expect(parseCloudOrigin("https://campfire.example:8443")).toBe("https://campfire.example:8443");
  });

  it("allows http only for localhost dev servers", () => {
    expect(parseCloudOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(parseCloudOrigin("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
    expect(parseCloudOrigin("http://campfire.example")).toBeNull();
    expect(parseCloudOrigin("http://192.168.1.5:3939")).toBeNull();
  });

  it("treats blank, malformed and non-web URLs as not configured", () => {
    for (const raw of ["", "   ", undefined, null, 42, "campfire.example", "https://", "ftp://campfire.example", "file:///C:/campfire"]) {
      expect(parseCloudOrigin(raw)).toBeNull();
    }
  });
});

describe("defaultMode", () => {
  it("is host for a host-only build, whatever is on disk", () => {
    const userDataPath = temporaryDirectory();
    expect(defaultMode({ cloudOrigin: null, userDataPath })).toBe("host");
  });

  it("is cloud for a fresh install of a cloud build", () => {
    const userDataPath = temporaryDirectory();
    expect(defaultMode({ cloudOrigin: CLOUD, userDataPath })).toBe("cloud");
    // Settings/logs alone are not local communities.
    touch(join(userDataPath, "desktop-settings.json"));
    touch(join(userDataPath, "logs", "desktop.log"));
    expect(defaultMode({ cloudOrigin: CLOUD, userDataPath })).toBe("cloud");
  });

  it("keeps existing beta users on their local server", () => {
    const userDataPath = temporaryDirectory();
    touch(join(userDataPath, "data", "campfire.db"));
    expect(defaultMode({ cloudOrigin: CLOUD, userDataPath })).toBe("host");
  });

  it("keeps v0.0.3 installer users with state still to import on host", () => {
    const userDataPath = temporaryDirectory();
    touch(join(userDataPath, "campfire.db"));
    expect(defaultMode({ cloudOrigin: CLOUD, userDataPath })).toBe("host");
  });

  it("checks the portable legacy location beside the executable", () => {
    const portableDirectory = temporaryDirectory();
    const userDataPath = join(portableDirectory, "CampfireData");
    expect(defaultMode({ cloudOrigin: CLOUD, userDataPath, portableDirectory })).toBe("cloud");
    touch(join(portableDirectory, "data", "campfire.db"));
    expect(defaultMode({ cloudOrigin: CLOUD, userDataPath, portableDirectory })).toBe("host");
  });
});

describe("telemetryEnabled", () => {
  it("is on by default in packaged builds and off in dev runs", () => {
    expect(telemetryEnabled({ env: {}, isPackaged: true })).toBe(true);
    expect(telemetryEnabled({ setting: true, env: {}, isPackaged: true })).toBe(true);
    expect(telemetryEnabled({ env: {}, isPackaged: false })).toBe(false);
  });

  it("runs in dev only when a collector is named explicitly", () => {
    expect(telemetryEnabled({ env: { CAMPFIRE_TELEMETRY_URL: "http://localhost:3000/api/telemetry/ping" }, isPackaged: false })).toBe(true);
  });

  it("honours the tray opt-out", () => {
    expect(telemetryEnabled({ setting: false, env: {}, isPackaged: true })).toBe(false);
  });

  it("honours CAMPFIRE_TELEMETRY off-values case-insensitively", () => {
    for (const value of ["0", "false", "OFF", "No", " off "]) {
      expect(telemetryEnabled({ env: { CAMPFIRE_TELEMETRY: value }, isPackaged: true })).toBe(false);
    }
    for (const value of ["1", "on", "true", ""]) {
      expect(telemetryEnabled({ env: { CAMPFIRE_TELEMETRY: value }, isPackaged: true })).toBe(true);
    }
  });

  it("honours DO_NOT_TRACK", () => {
    for (const value of ["1", "true", "TRUE"]) {
      expect(telemetryEnabled({ env: { DO_NOT_TRACK: value }, isPackaged: true })).toBe(false);
    }
    expect(telemetryEnabled({ env: { DO_NOT_TRACK: "0" }, isPackaged: true })).toBe(true);
    expect(
      telemetryEnabled({ env: { DO_NOT_TRACK: "1", CAMPFIRE_TELEMETRY_URL: "https://collector.example/p" }, isPackaged: false }),
    ).toBe(false);
  });
});

describe("telemetryTarget", () => {
  it("uses the shared ping path on Campfire Online", () => {
    expect(DESKTOP_PING_PATH).toBe(TELEMETRY_PING_PATH);
    expect(telemetryTarget({}, CLOUD)).toBe(`${CLOUD}${TELEMETRY_PING_PATH}`);
  });

  it("lets CAMPFIRE_TELEMETRY_URL override, even without a cloud URL", () => {
    const explicit = "http://localhost:3000/api/telemetry/ping";
    expect(telemetryTarget({ CAMPFIRE_TELEMETRY_URL: explicit }, CLOUD)).toBe(explicit);
    expect(telemetryTarget({ CAMPFIRE_TELEMETRY_URL: explicit }, null)).toBe(explicit);
  });

  it("pings nowhere when nothing is configured or the override is unusable", () => {
    expect(telemetryTarget({}, null)).toBeNull();
    expect(telemetryTarget({ CAMPFIRE_TELEMETRY_URL: "not a url" }, CLOUD)).toBeNull();
    expect(telemetryTarget({ CAMPFIRE_TELEMETRY_URL: "ftp://collector.example/p" }, CLOUD)).toBeNull();
    // Same rule as the server reporter: plain http only to localhost.
    expect(telemetryTarget({ CAMPFIRE_TELEMETRY_URL: "http://collector.example/p" }, CLOUD)).toBeNull();
    expect(telemetryTarget({ CAMPFIRE_TELEMETRY_URL: "https://collector.example/p" }, null)).toBe("https://collector.example/p");
  });
});

describe("buildDesktopPing", () => {
  it("builds exactly the ping the collector accepts", () => {
    for (const mode of ["cloud", "host"] as const) {
      const ping = buildDesktopPing({
        installId: randomUUID(),
        mode,
        version: "0.1.0-beta.1",
        platform: "win32",
        arch: "x64",
      });
      expect(parseTelemetryPing(JSON.parse(JSON.stringify(ping)))).toEqual(ping);
      expect(ping).toMatchObject({ kind: "desktop", mode, platform: "win32-x64", edition: null, users: null, activeUsers: null });
    }
  });

  it("carries nothing beyond the protocol fields", () => {
    const ping = buildDesktopPing({ installId: randomUUID(), mode: "cloud", version: "1.0.0", platform: "win32", arch: "x64" });
    expect(Object.keys(ping).sort()).toEqual(
      ["activeUsers", "edition", "installId", "kind", "mode", "platform", "users", "v", "version"],
    );
  });
});

describe("notice parsing (desktop twin of parseTelemetryNotice)", () => {
  const URL_OK = "https://campfire.example/pro";
  const inputs: unknown[] = [
    null,
    undefined,
    0,
    "notice",
    [],
    [{ id: "launch-1", text: "x" }],
    { id: "launch-1", text: "Campfire Pro is here" },
    { id: "launch-1", text: "  padded text  " },
    { id: "launch-1", text: "x", extra: "ignored" },
    { id: "launch-1", text: "x", url: URL_OK, urlLabel: " Learn more " },
    { id: "launch-1", text: "x", url: URL_OK },
    { id: "launch-1", text: "x", url: "HTTPS://Campfire.Example/Pro?x=1#y" },
    { id: "launch-1", text: "x", url: null, urlLabel: "dropped without a url" },
    { id: "launch-1", text: "x", urlLabel: "dropped without a url" },
    { id: "launch-1", text: "x", url: "http://campfire.example/pro" },
    { id: "launch-1", text: "x", url: "javascript:alert(1)" },
    { id: "launch-1", text: "x", url: "file:///C:/Windows" },
    { id: "launch-1", text: "x", url: "not a url" },
    { id: "launch-1", text: "x", url: `https://campfire.example/${"a".repeat(500)}` },
    { id: "launch-1", text: "x", url: 5 },
    { id: "launch-1", text: "x", url: URL_OK, urlLabel: "" },
    { id: "launch-1", text: "x", url: URL_OK, urlLabel: "   " },
    { id: "launch-1", text: "x", url: URL_OK, urlLabel: "l".repeat(40) },
    { id: "launch-1", text: "x", url: URL_OK, urlLabel: "l".repeat(41) },
    { id: "launch-1", text: "x", url: URL_OK, urlLabel: 7 },
    { id: "", text: "x" },
    { id: "has space", text: "x" },
    { id: "launch-1\n", text: "x" },
    { id: "a".repeat(64), text: "x" },
    { id: "a".repeat(65), text: "x" },
    { id: 1, text: "x" },
    { text: "x" },
    { id: "launch-1", text: "" },
    { id: "launch-1", text: "   " },
    { id: "launch-1", text: ` ${"t".repeat(280)} ` },
    { id: "launch-1", text: "t".repeat(281) },
    { id: "launch-1", text: 3 },
  ];

  it("agrees with lib/telemetryProtocol on every input", () => {
    for (const input of inputs) {
      expect(parseDesktopNotice(input), JSON.stringify(input)).toEqual(parseTelemetryNotice(input));
    }
    // Not vacuous: the table holds both accepted and rejected notices.
    const accepted = inputs.filter((input) => parseTelemetryNotice(input) !== null);
    expect(accepted.length).toBeGreaterThan(5);
    expect(accepted.length).toBeLessThan(inputs.length - 10);
  });

  it("normalizes what it accepts", () => {
    expect(parseDesktopNotice({ id: "launch-1", text: " Hi ", url: URL_OK, urlLabel: " Go " })).toEqual({
      id: "launch-1",
      text: "Hi",
      url: URL_OK,
      urlLabel: "Go",
    });
    expect(parseDesktopNotice({ id: "launch-1", text: "Hi", urlLabel: "Go" })).toEqual({
      id: "launch-1",
      text: "Hi",
      url: null,
      urlLabel: null,
    });
  });

  it("reads a notice only from a 200 ping reply", () => {
    const notice = { id: "launch-1", text: "Campfire Pro is here", url: URL_OK, urlLabel: "See it" };
    expect(noticeFromPingResponse(200, JSON.stringify({ notice }))).toEqual(notice);
    expect(noticeFromPingResponse(204, "")).toBeNull();
    expect(noticeFromPingResponse(500, JSON.stringify({ notice }))).toBeNull();
    for (const body of ["", "null", "not json", "[]", '{"notice":null}', '{"notice":{"id":"x"}}']) {
      expect(noticeFromPingResponse(200, body)).toBeNull();
    }
    expect(noticeFromPingResponse(200, JSON.stringify({ notice, padding: "p".repeat(9000) }))).toBeNull();
  });
});

describe("notice display bookkeeping", () => {
  const notice = { id: "launch-1", text: "Campfire Pro is here", url: null, urlLabel: null };

  it("shows a notice only in host mode and only until it has been shown", () => {
    expect(shouldShowNotice({ notice, mode: "host", dismissedIds: undefined })).toBe(true);
    expect(shouldShowNotice({ notice, mode: "host", dismissedIds: ["older"] })).toBe(true);
    expect(shouldShowNotice({ notice, mode: "host", dismissedIds: "garbage" })).toBe(true);
    expect(shouldShowNotice({ notice, mode: "host", dismissedIds: ["launch-1"] })).toBe(false);
    expect(shouldShowNotice({ notice, mode: "cloud", dismissedIds: [] })).toBe(false);
    expect(shouldShowNotice({ notice: null, mode: "host", dismissedIds: [] })).toBe(false);
  });

  it("remembers ids most-recent-last, without duplicates or junk, capped at 50", () => {
    expect(rememberNotice(undefined, "a")).toEqual(["a"]);
    expect(rememberNotice(["a", 7, null, "b"], "c")).toEqual(["a", "b", "c"]);
    expect(rememberNotice(["a", "b"], "a")).toEqual(["b", "a"]);
    const many = Array.from({ length: 60 }, (_, index) => `n${index}`);
    const kept = rememberNotice(many, "latest");
    expect(kept).toHaveLength(50);
    expect(kept.at(-1)).toBe("latest");
    expect(kept[0]).toBe("n11");
    expect(shouldShowNotice({ notice, mode: "host", dismissedIds: rememberNotice(many, notice.id) })).toBe(false);
  });
});

describe("updates", () => {
  it("auto-updates installed Windows builds only", () => {
    expect(updateMode({ isPackaged: true, platform: "win32" })).toBe("auto");
    expect(updateMode({ isPackaged: true, platform: "win32", portableDirectory: null })).toBe("auto");
    // Portable: no installer to re-run, keep the download prompt.
    expect(updateMode({ isPackaged: true, platform: "win32", portableDirectory: "D:\\Campfire" })).toBe("manual");
    expect(updateMode({ isPackaged: true, platform: "darwin" })).toBe("manual");
    expect(updateMode({ isPackaged: false, platform: "win32" })).toBe("off");
  });

  it("follows prereleases only from a prerelease", () => {
    for (const version of ["0.1.0-beta.1", "v0.1.0-beta.1", "1.0.0-rc.1", "1.0.0-rc.1+build.5"]) {
      expect(isPrerelease(version), version).toBe(true);
    }
    for (const version of ["1.0.0", "v1.0.0", "1.0.0+build.5", "", undefined, "beta"]) {
      expect(isPrerelease(version), String(version)).toBe(false);
    }
  });

  it("matches a skipped GitHub tag against an updater version", () => {
    expect(sameVersion("v0.1.0-beta.2", "0.1.0-beta.2")).toBe(true);
    expect(sameVersion("0.1.0-beta.2", "0.1.0-beta.2")).toBe(true);
    expect(sameVersion("v0.1.0-beta.2", "0.1.0-beta.3")).toBe(false);
    expect(sameVersion(undefined, "0.1.0")).toBe(false);
    expect(sameVersion("", "")).toBe(false);
  });

  it("lets CAMPFIRE_UPDATE_FEED_URL point at a local feed, https or localhost only", () => {
    expect(updateFeedOverride({})).toBeNull();
    expect(updateFeedOverride({ CAMPFIRE_UPDATE_FEED_URL: "http://localhost:8080" })).toEqual({
      provider: "generic",
      url: "http://localhost:8080/",
    });
    expect(updateFeedOverride({ CAMPFIRE_UPDATE_FEED_URL: "https://updates.example/campfire/" })).toEqual({
      provider: "generic",
      url: "https://updates.example/campfire/",
    });
    for (const value of ["", "  ", "not a url", "http://updates.example/", "file:///C:/dist"]) {
      expect(updateFeedOverride({ CAMPFIRE_UPDATE_FEED_URL: value }), value).toBeNull();
    }
  });
});
