import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TELEMETRY_PING_PATH as DESKTOP_PING_PATH,
  buildDesktopPing,
  defaultMode,
  parseCloudOrigin,
  telemetryEnabled,
  telemetryTarget,
} from "@/desktop/launcher-core.cjs";
import { TELEMETRY_PING_PATH, parseTelemetryPing } from "@/lib/telemetryProtocol";

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
