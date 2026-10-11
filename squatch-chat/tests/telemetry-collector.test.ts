import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/telemetry/ping/route";
import { prisma } from "@/lib/db";
import {
  githubReleaseDownloads,
  isTelemetryCollector,
  pruneStaleInstalls,
  recordTelemetryPing,
  telemetrySummary,
} from "@/lib/telemetryCollector";
import { parseTelemetryPing } from "@/lib/telemetryProtocol";

// POST /api/telemetry/ping against the test DB, plus the /admin aggregates.
// Each test pings from its own documentation-range IP so the in-memory
// limiter (keyed by X-Forwarded-For; tests/setup.ts trusts one hop) is isolated.

const originalCollector = process.env.CAMPFIRE_TELEMETRY_COLLECTOR;

function ping(body: unknown, ip: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://test.local/api/telemetry/ping", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function desktopPing(installId: string, version = "1.0.0") {
  return {
    v: 1,
    installId,
    kind: "desktop",
    mode: "cloud",
    version,
    edition: null,
    platform: "win32-x64",
    users: null,
    activeUsers: null,
  };
}

beforeEach(() => {
  process.env.CAMPFIRE_TELEMETRY_COLLECTOR = "1";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(() => {
  if (originalCollector === undefined) delete process.env.CAMPFIRE_TELEMETRY_COLLECTOR;
  else process.env.CAMPFIRE_TELEMETRY_COLLECTOR = originalCollector;
});

describe("isTelemetryCollector", () => {
  it("accepts only 1/true", () => {
    expect(isTelemetryCollector({ CAMPFIRE_TELEMETRY_COLLECTOR: "1" })).toBe(true);
    expect(isTelemetryCollector({ CAMPFIRE_TELEMETRY_COLLECTOR: " TRUE " })).toBe(true);
    expect(isTelemetryCollector({ CAMPFIRE_TELEMETRY_COLLECTOR: "yes" })).toBe(false);
    expect(isTelemetryCollector({ CAMPFIRE_TELEMETRY_COLLECTOR: "0" })).toBe(false);
    expect(isTelemetryCollector({})).toBe(false);
  });
});

describe("POST /api/telemetry/ping", () => {
  it("is a 404 unless this instance is the collector", async () => {
    delete process.env.CAMPFIRE_TELEMETRY_COLLECTOR;
    const res = await ping(desktopPing("off-collector-install-1"), "198.51.100.1");
    expect(res.status).toBe(404);
    expect(await prisma.telemetryInstall.count({ where: { installId: "off-collector-install-1" } })).toBe(0);
  });

  it("rejects malformed and invalid pings with 400", async () => {
    expect((await ping("{not json", "198.51.100.2")).status).toBe(400);
    expect((await ping({ ...desktopPing("short"), installId: "short" }, "198.51.100.2")).status).toBe(400);
    expect((await ping({ ...desktopPing("bad-kind-install-01"), kind: "phone" }, "198.51.100.2")).status).toBe(400);
    expect((await ping([1, 2, 3], "198.51.100.2")).status).toBe(400);
  });

  it("rejects oversized bodies before parsing, whatever Content-Length says", async () => {
    const declared = await ping(desktopPing("declared-big-install"), "198.51.100.3", {
      "content-length": "999999",
    });
    expect(declared.status).toBe(413);

    // No Content-Length on a string body here, so only the streaming cap stops it.
    const padded = JSON.stringify({ ...desktopPing("streamed-big-install"), pad: "x".repeat(3000) });
    const streamed = await ping(padded, "198.51.100.3");
    expect(streamed.status).toBe(413);
    expect(await prisma.telemetryInstall.count({ where: { installId: "streamed-big-install" } })).toBe(0);
  });

  it("records a new install and answers 204 with no body", async () => {
    const res = await ping(desktopPing("new-install-abcdef12"), "198.51.100.4");
    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");

    const row = await prisma.telemetryInstall.findUnique({ where: { installId: "new-install-abcdef12" } });
    expect(row).toMatchObject({
      kind: "desktop",
      mode: "cloud",
      version: "1.0.0",
      platform: "win32-x64",
      edition: null,
      users: null,
    });
  });

  it("refreshes an existing install but keeps when it was first seen", async () => {
    const firstSeenAt = new Date("2026-01-01T00:00:00Z");
    await prisma.telemetryInstall.create({
      data: {
        installId: "repeat-install-abcdef",
        kind: "server",
        version: "0.9.0",
        edition: "community",
        users: 3,
        activeUsers: 1,
        firstSeenAt,
        lastSeenAt: firstSeenAt,
      },
    });

    const res = await ping(
      {
        v: 1,
        installId: "repeat-install-abcdef",
        kind: "server",
        mode: null,
        version: "1.1.0",
        edition: "community",
        platform: null,
        users: 12,
        activeUsers: 5,
      },
      "198.51.100.5",
    );
    expect(res.status).toBe(204);

    const row = await prisma.telemetryInstall.findUniqueOrThrow({
      where: { installId: "repeat-install-abcdef" },
    });
    expect(row.version).toBe("1.1.0");
    expect(row.users).toBe(12);
    expect(row.activeUsers).toBe(5);
    expect(row.firstSeenAt.getTime()).toBe(firstSeenAt.getTime());
    expect(row.lastSeenAt.getTime()).toBeGreaterThan(firstSeenAt.getTime());
  });

  it("rate-limits each IP before parsing the body", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await ping({}, "198.51.100.6")).status).toBe(400);
    }
    const limited = await ping(desktopPing("limited-install-abcdef"), "198.51.100.6");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);

    // A different address still gets through.
    expect((await ping(desktopPing("unlimited-install-abcd"), "198.51.100.7")).status).toBe(204);
  });

  it("rate-limits a whole IPv6 /64 as one sender", async () => {
    for (let i = 0; i < 20; i++) {
      expect((await ping({}, `2001:db8:6:6::${(i + 1).toString(16)}`)).status).toBe(400);
    }
    expect((await ping(desktopPing("ipv6-rotated-install-1"), "2001:db8:6:6:ffff::99")).status).toBe(429);
    expect((await ping(desktopPing("ipv6-other-net-install"), "2001:db8:6:7::1")).status).toBe(204);
  });

  it("refuses non-JSON bodies, so other sites can't make browsers ping", async () => {
    const res = await ping(desktopPing("text-plain-install-01"), "198.51.100.8", { "content-type": "text/plain" });
    expect(res.status).toBe(415);
    expect(await prisma.telemetryInstall.count({ where: { installId: "text-plain-install-01" } })).toBe(0);
  });
});

describe("recordTelemetryPing", () => {
  it("refreshes known installs but creates new ones only within the budget", async () => {
    const parsed = (installId: string) => parseTelemetryPing(desktopPing(installId))!;
    expect(await recordTelemetryPing(parsed("budget-known-install1"))).toBe(true);

    const noBudget = () => false;
    expect(await recordTelemetryPing({ ...parsed("budget-known-install1"), version: "2.0.0" }, new Date(), noBudget)).toBe(true);
    expect(await recordTelemetryPing(parsed("budget-new-install-01"), new Date(), noBudget)).toBe(false);

    expect((await prisma.telemetryInstall.findUniqueOrThrow({ where: { installId: "budget-known-install1" } })).version).toBe("2.0.0");
    expect(await prisma.telemetryInstall.count({ where: { installId: "budget-new-install-01" } })).toBe(0);
  });
});

describe("pruneStaleInstalls", () => {
  it("deletes installs silent for 90 days and keeps the rest", async () => {
    const now = new Date();
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    await prisma.telemetryInstall.createMany({
      data: [
        { installId: "prune-stale-install-01", kind: "desktop", mode: "cloud", version: "1.0.0", firstSeenAt: daysAgo(200), lastSeenAt: daysAgo(91) },
        { installId: "prune-fresh-install-01", kind: "desktop", mode: "cloud", version: "1.0.0", firstSeenAt: daysAgo(200), lastSeenAt: daysAgo(89) },
      ],
    });

    expect(await pruneStaleInstalls(now)).toBeGreaterThanOrEqual(1);
    expect(await prisma.telemetryInstall.count({ where: { installId: "prune-stale-install-01" } })).toBe(0);
    expect(await prisma.telemetryInstall.count({ where: { installId: "prune-fresh-install-01" } })).toBe(1);
  });
});

describe("telemetrySummary", () => {
  it("splits active installs by kind and window and sums self-hosted people", async () => {
    // Far-future "now" so rows written by the route tests above fall outside every window.
    const now = new Date("2100-01-01T12:00:00Z");
    const ago = (hours: number) => new Date(now.getTime() - hours * 60 * 60 * 1000);
    const day = 24;
    await prisma.telemetryInstall.createMany({
      data: [
        { installId: "sum-desktop-cloud-1", kind: "desktop", mode: "cloud", version: "1.0.0", firstSeenAt: ago(2 * day), lastSeenAt: ago(1) },
        { installId: "sum-desktop-cloud-2", kind: "desktop", mode: "cloud", version: "1.0.0", firstSeenAt: ago(20 * day), lastSeenAt: ago(3 * day) },
        { installId: "sum-desktop-host-01", kind: "desktop", mode: "host", version: "0.9.0", firstSeenAt: ago(60 * day), lastSeenAt: ago(10 * day) },
        { installId: "sum-server-recent-1", kind: "server", version: "1.0.0", edition: "community", users: 10, activeUsers: 4, firstSeenAt: ago(5), lastSeenAt: ago(2) },
        { installId: "sum-server-stale-01", kind: "server", version: "0.8.0", edition: "community", users: 5, activeUsers: 1, firstSeenAt: ago(100 * day), lastSeenAt: ago(40 * day) },
        // A forged ping claiming millions of accounts: an install, but not people.
        { installId: "sum-server-forged-1", kind: "server", version: "0.9.0", edition: "community", users: 9_000_000, activeUsers: 9_000_000, firstSeenAt: ago(20 * day), lastSeenAt: ago(20 * day) },
      ],
    });

    const summary = await telemetrySummary(now);
    expect(summary.active).toEqual([
      { days: 1, desktopCloud: 1, desktopHost: 0, server: 1, total: 2 },
      { days: 7, desktopCloud: 2, desktopHost: 0, server: 1, total: 3 },
      { days: 30, desktopCloud: 2, desktopHost: 1, server: 2, total: 5 },
    ]);
    expect(summary.selfHostedUsers).toBe(10);
    expect(summary.selfHostedActiveUsers).toBe(4);
    expect(summary.versions).toEqual([{ version: "1.0.0", installs: 3 }]);
    expect(summary.newInstallDates).toHaveLength(2);
  });
});

describe("githubReleaseDownloads", () => {
  it("sums asset downloads per release and overall", async () => {
    const releases = Array.from({ length: 7 }, (_, i) => ({
      tag_name: `v0.${7 - i}.0`,
      assets: [{ download_count: 10 }, { download_count: i }],
    }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(releases))));

    const downloads = await githubReleaseDownloads();
    expect(downloads?.total).toBe(7 * 10 + (0 + 1 + 2 + 3 + 4 + 5 + 6));
    expect(downloads?.releases).toHaveLength(5);
    expect(downloads?.releases[0]).toEqual({ name: "v0.7.0", downloads: 10 });
  });

  it("fails soft when GitHub errors or is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 403 })));
    expect(await githubReleaseDownloads()).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    expect(await githubReleaseDownloads()).toBeNull();
  });
});
