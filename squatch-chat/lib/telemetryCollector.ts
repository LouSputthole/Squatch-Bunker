import { prisma } from "@/lib/db";
import type { TelemetryPing } from "@/lib/telemetryProtocol";

// Collector side of the anonymous install ping: storage for
// app/api/telemetry/ping and the "Campfire in the wild" numbers on /admin.

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_AFTER_DAYS = 90;
// ponytail: anyone can send a ping, so one fake server could claim millions of
// accounts. Account sums skip servers claiming more than this (they still count as installs).
const PLAUSIBLE_SERVER_USERS = 100_000;
// ponytail: one page, so the total covers the newest 100 releases only.
const RELEASES_URL = "https://api.github.com/repos/LouSputthole/Squatch-Bunker/releases?per_page=100";

/** Only the official hosted instance collects; everywhere else the ping route is a 404. */
export function isTelemetryCollector(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true)$/i.test(env.CAMPFIRE_TELEMETRY_COLLECTOR?.trim() ?? "");
}

/**
 * One row per install: the first ping creates it, every later ping refreshes it.
 * A new install is created only if `allowNewInstall()` agrees; returns false when it doesn't.
 */
export async function recordTelemetryPing(
  ping: TelemetryPing,
  now = new Date(),
  allowNewInstall: () => boolean = () => true,
): Promise<boolean> {
  const fields = {
    kind: ping.kind,
    mode: ping.mode,
    version: ping.version,
    edition: ping.edition,
    platform: ping.platform,
    users: ping.users,
    activeUsers: ping.activeUsers,
    lastSeenAt: now,
  };
  const refreshed = await prisma.telemetryInstall.updateMany({
    where: { installId: ping.installId },
    data: fields,
  });
  if (refreshed.count > 0) return true;
  if (!allowNewInstall()) return false;
  // Upsert: a concurrent first ping from the same install may have just created it.
  await prisma.telemetryInstall.upsert({
    where: { installId: ping.installId },
    create: { installId: ping.installId, firstSeenAt: now, ...fields },
    update: fields,
  });
  return true;
}

/** Installs silent for 90 days are gone; this also clears fake rows nobody refreshes. */
export async function pruneStaleInstalls(now = new Date()): Promise<number> {
  const { count } = await prisma.telemetryInstall.deleteMany({
    where: { lastSeenAt: { lt: new Date(now.getTime() - STALE_AFTER_DAYS * DAY_MS) } },
  });
  return count;
}

export interface ActiveInstalls {
  days: number;
  desktopCloud: number;
  desktopHost: number;
  server: number;
  total: number;
}

export async function telemetrySummary(now = new Date()) {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const [active, servers, versions, newInstalls] = await Promise.all([
    Promise.all(
      [1, 7, 30].map(async (days): Promise<ActiveInstalls> => {
        const groups = await prisma.telemetryInstall.groupBy({
          by: ["kind", "mode"],
          where: { lastSeenAt: { gte: since(days) } },
          _count: { _all: true },
        });
        const sum = (match: (group: (typeof groups)[number]) => boolean) =>
          groups.filter(match).reduce((total, group) => total + group._count._all, 0);
        return {
          days,
          desktopCloud: sum((g) => g.kind === "desktop" && g.mode === "cloud"),
          desktopHost: sum((g) => g.kind === "desktop" && g.mode === "host"),
          server: sum((g) => g.kind === "server"),
          total: sum(() => true),
        };
      }),
    ),
    prisma.telemetryInstall.aggregate({
      where: {
        kind: "server",
        lastSeenAt: { gte: since(30) },
        users: { lte: PLAUSIBLE_SERVER_USERS },
        activeUsers: { lte: PLAUSIBLE_SERVER_USERS },
      },
      _sum: { users: true, activeUsers: true },
    }),
    prisma.telemetryInstall.groupBy({
      by: ["version"],
      where: { lastSeenAt: { gte: since(7) } },
      _count: { version: true },
      orderBy: { _count: { version: "desc" } },
      take: 10,
    }),
    // ponytail: one row per new install; fine until launches bring ~100k
    // installs a fortnight, then bucket by day in SQL.
    prisma.telemetryInstall.findMany({
      where: { firstSeenAt: { gte: since(14) } },
      select: { firstSeenAt: true },
    }),
  ]);
  return {
    active,
    selfHostedUsers: servers._sum.users ?? 0,
    selfHostedActiveUsers: servers._sum.activeUsers ?? 0,
    versions: versions.map((v) => ({ version: v.version, installs: v._count.version })),
    newInstallDates: newInstalls.map((row) => row.firstSeenAt),
  };
}

export interface ReleaseDownloads {
  total: number;
  /** Newest first, at most 5. */
  releases: { name: string; downloads: number }[];
}

/** GitHub release asset downloads, cached for an hour; null when GitHub can't be reached. */
export async function githubReleaseDownloads(): Promise<ReleaseDownloads | null> {
  try {
    const response = await fetch(RELEASES_URL, {
      headers: { "User-Agent": "Campfire-admin", Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    if (!Array.isArray(body)) return null;
    const releases = body.map((release) => ({
      name: String(release?.tag_name ?? release?.name ?? "untagged"),
      downloads: Array.isArray(release?.assets)
        ? release.assets.reduce(
            (sum: number, asset: { download_count?: unknown }) =>
              sum + (Number.isSafeInteger(asset?.download_count) ? (asset.download_count as number) : 0),
            0,
          )
        : 0,
    }));
    return {
      total: releases.reduce((sum, release) => sum + release.downloads, 0),
      releases: releases.slice(0, 5),
    };
  } catch {
    return null;
  }
}
