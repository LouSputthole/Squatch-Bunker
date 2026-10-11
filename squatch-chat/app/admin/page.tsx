import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isInstanceAdmin } from "@/lib/instanceAdmin";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

async function getDashboardNow(): Promise<Date> {
  return new Date();
}

/** Bucket timestamps into the last `days` UTC days, oldest first. */
function perDay(dates: Date[], nowMs: number, days: number) {
  const counts: Record<string, number> = {};
  for (let i = days - 1; i >= 0; i--) {
    counts[new Date(nowMs - i * DAY_IN_MS).toISOString().slice(0, 10)] = 0;
  }
  for (const date of dates) {
    const key = date.toISOString().slice(0, 10);
    if (key in counts) counts[key]++;
  }
  return Object.entries(counts).map(([date, count]) => ({
    label: date.slice(5), // MM-DD
    value: count,
  }));
}

function windowLabel(days: number) {
  return days === 1 ? "24 hours" : `${days} days`;
}

function BarChart({
  data,
  label,
}: {
  data: { label: string; value: number }[];
  label: string;
}) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const barWidth = 32;
  const barGap = 8;
  const barStep = barWidth + barGap;
  const svgWidth = data.length * barStep;

  return (
    <div className="bg-[var(--panel)] rounded-lg p-4">
      <h3 className="text-sm font-semibold text-[var(--muted)] mb-3 uppercase tracking-wide">
        {label}
      </h3>
      <svg
        width="100%"
        height="120"
        viewBox={`0 0 ${svgWidth} 100`}
        preserveAspectRatio="none"
      >
        {data.map((d, i) => {
          const h = Math.max(Math.round((d.value / max) * 80), d.value > 0 ? 4 : 0);
          return (
            <g key={i}>
              <rect
                x={i * barStep + 4}
                y={100 - h}
                width={barWidth}
                height={h}
                fill="var(--accent-2, #5865f2)"
                rx={3}
              />
              <text
                x={i * barStep + 4 + barWidth / 2}
                y={96}
                textAnchor="middle"
                fontSize="8"
                fill="var(--muted, #888)"
              >
                {d.value}
              </text>
            </g>
          );
        })}
      </svg>
      <div
        className="flex mt-1"
        style={{ justifyContent: "space-between" }}
      >
        {data.map((d, i) => (
          <span
            key={i}
            className="text-[10px] text-[var(--muted)]"
            style={{ width: `${100 / data.length}%`, textAlign: "center" }}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function AdminPage() {
  const session = await getSession();
  if (!session || !isInstanceAdmin(session.userId)) notFound();

  const { prisma } = await import("@/lib/db");
  const { listUnscopedOpenReports } = await import("@/lib/reports");
  const { githubReleaseDownloads, isTelemetryCollector, telemetrySummary } = await import(
    "@/lib/telemetryCollector"
  );

  const now = await getDashboardNow();
  const nowMs = now.getTime();
  const sevenDaysAgo = new Date(nowMs - 7 * DAY_IN_MS);

  const [
    totalUsers,
    totalServers,
    totalMessages,
    recentMessages,
    topServers,
    topChannels,
    openReports,
    unscopedReports,
  ] =
    await Promise.all([
      prisma.user.count(),
      prisma.server.count(),
      prisma.message.count(),
      prisma.message.findMany({
        where: { createdAt: { gte: sevenDaysAgo } },
        select: { createdAt: true },
      }),
      prisma.server.findMany({
        include: { _count: { select: { members: true, channels: true } } },
        orderBy: { createdAt: "desc" },
        take: 7,
      }),
      prisma.channel.findMany({
        include: { _count: { select: { messages: true } } },
        orderBy: { createdAt: "desc" },
        take: 7,
      }),
      prisma.report.count({ where: { status: "open" } }),
      // Reports with no provable server context never reach a server's
      // Ranger Desk, so the operator is their only reader.
      listUnscopedOpenReports(),
    ]);

  // People = distinct message authors; guests split out. Install pings and
  // GitHub downloads only matter on the official instance running the collector.
  const since = (days: number) => new Date(nowMs - days * DAY_IN_MS);
  const authorsSince = (days: number, isGuest: boolean) =>
    prisma.user.count({
      where: { isGuest, messages: { some: { createdAt: { gte: since(days) } } } },
    });
  const collecting = isTelemetryCollector();
  const [people, recentSignups, wild, downloads] = await Promise.all([
    Promise.all(
      [1, 7, 30].map(async (days) => {
        const [members, guests] = await Promise.all([
          authorsSince(days, false),
          authorsSince(days, true),
        ]);
        return { days, members, guests };
      }),
    ),
    prisma.user.findMany({
      where: { isGuest: false, createdAt: { gte: since(14) } },
      select: { createdAt: true },
    }),
    collecting ? telemetrySummary(now) : null,
    collecting ? githubReleaseDownloads() : null,
  ]);

  const messagesPerDay = perDay(recentMessages.map((m) => m.createdAt), nowMs, 7);
  const signupsPerDay = perDay(recentSignups.map((u) => u.createdAt), nowMs, 14);

  const serverData = topServers.map((s) => ({
    label: s.name.slice(0, 5),
    value: s._count.members,
  }));

  const channelData = topChannels.map((c) => ({
    label: c.name.slice(0, 5),
    value: c._count.messages,
  }));

  const stats = [
    { label: "Total Users", value: totalUsers },
    { label: "Total Servers", value: totalServers },
    { label: "Total Messages", value: totalMessages },
    { label: "Open Reports", value: openReports },
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-8">
      <h1 className="text-2xl font-bold mb-2">Admin Dashboard</h1>
      <p className="text-sm text-[var(--muted)] mb-8">
        Logged in as <strong>{session.username}</strong>
      </p>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-[var(--panel)] rounded-lg p-4"
          >
            <div className="text-3xl font-bold text-[var(--accent)]">
              {stat.value.toLocaleString()}
            </div>
            <div className="text-sm text-[var(--muted)] mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <BarChart data={messagesPerDay} label="Messages per Day (last 7 days)" />
        {serverData.length > 0 && (
          <BarChart data={serverData} label="Members per Server (recent)" />
        )}
        {channelData.length > 0 && (
          <BarChart data={channelData} label="Messages per Channel (recent)" />
        )}
      </div>

      <section className="mt-8">
        <h2 className="text-lg font-bold mb-1">People on this instance</h2>
        <p className="text-xs text-[var(--muted)] mb-4">
          Distinct people who posted in a channel in each window.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          {people.map((p) => (
            <div key={p.days} className="bg-[var(--panel)] rounded-lg p-4">
              <div className="text-3xl font-bold text-[var(--accent)]">
                {p.members.toLocaleString()}
              </div>
              <div className="text-sm text-[var(--muted)] mt-1">
                Active in the last {windowLabel(p.days)} · +{p.guests.toLocaleString()} guests
              </div>
            </div>
          ))}
        </div>
        <BarChart data={signupsPerDay} label="Sign-ups per Day (last 14 days)" />
      </section>

      {wild && (
        <section className="mt-8">
          <h2 className="text-lg font-bold mb-1">Campfire in the wild</h2>
          <p className="text-xs text-[var(--muted)] mb-4">
            Installs that sent an anonymous ping in each window. Opted-out installs never appear.
          </p>
          <div className="bg-[var(--panel)] rounded-lg p-4 mb-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[var(--muted)]">
                <tr>
                  <th className="py-1 pr-4 font-semibold">Seen in last</th>
                  <th className="py-1 pr-4 font-semibold">Desktop · online</th>
                  <th className="py-1 pr-4 font-semibold">Desktop · host on PC</th>
                  <th className="py-1 pr-4 font-semibold">Self-hosted servers</th>
                  <th className="py-1 font-semibold">All</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--accent-2)]/20">
                {wild.active.map((row) => (
                  <tr key={row.days}>
                    <td className="py-1 pr-4">{windowLabel(row.days)}</td>
                    <td className="py-1 pr-4">{row.desktopCloud.toLocaleString()}</td>
                    <td className="py-1 pr-4">{row.desktopHost.toLocaleString()}</td>
                    <td className="py-1 pr-4">{row.server.toLocaleString()}</td>
                    <td className="py-1 font-semibold">{row.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="bg-[var(--panel)] rounded-lg p-4">
              <div className="text-3xl font-bold text-[var(--accent)]">
                {wild.selfHostedUsers.toLocaleString()}
              </div>
              <div className="text-sm text-[var(--muted)] mt-1">
                Accounts on self-hosted servers (servers seen in 30 days)
              </div>
            </div>
            <div className="bg-[var(--panel)] rounded-lg p-4">
              <div className="text-3xl font-bold text-[var(--accent)]">
                {wild.selfHostedActiveUsers.toLocaleString()}
              </div>
              <div className="text-sm text-[var(--muted)] mt-1">
                Active on self-hosted servers (posted in their last 7 days)
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            <BarChart
              data={perDay(wild.newInstallDates, nowMs, 14)}
              label="New Installs per Day (last 14 days)"
            />
            <div className="bg-[var(--panel)] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[var(--muted)] mb-3 uppercase tracking-wide">
                Versions (active last 7 days)
              </h3>
              {wild.versions.length === 0 ? (
                <p className="text-sm text-[var(--muted)]">No pings yet.</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {wild.versions.map((v) => (
                    <li key={v.version} className="flex justify-between gap-2">
                      <span className="font-mono">{v.version}</span>
                      <span className="text-[var(--muted)]">{v.installs.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="bg-[var(--panel)] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[var(--muted)] mb-3 uppercase tracking-wide">
                GitHub release downloads
              </h3>
              {downloads ? (
                <>
                  <div className="text-3xl font-bold text-[var(--accent)]">
                    {downloads.total.toLocaleString()}
                  </div>
                  <ul className="text-sm space-y-1 mt-2">
                    {downloads.releases.map((r, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span className="font-mono">{r.name}</span>
                        <span className="text-[var(--muted)]">{r.downloads.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-[var(--muted)]">Unavailable right now.</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* User-level and orphaned reports: no server desk can see these. */}
      <section className="mt-8 bg-[var(--panel)] rounded-lg p-4">
        <h3 className="text-sm font-semibold text-[var(--muted)] mb-1 uppercase tracking-wide">
          Reports without a server context
        </h3>
        <p className="text-xs text-[var(--muted)] mb-3">
          User-level reports and reports whose message was deleted. Message reports are handled by each
          server&apos;s moderators in the Moderation Panel.
        </p>
        {unscopedReports.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-[var(--accent-2)]/20">
            {unscopedReports.map((report) => (
              <li key={report.id} className="py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-2 text-xs">
                  <strong>{report.reporter.username}</strong>
                  <span className="text-[var(--muted)]">reported</span>
                  <strong className="text-[var(--danger)]">{report.targetUser.username}</strong>
                  {report.messageDeleted && <span className="text-[var(--muted)]">(message deleted)</span>}
                  <span className="ml-auto text-[var(--muted)]">{report.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words">{report.reason}</p>
                <p className="mt-0.5 text-[10px] text-[var(--muted)]">id {report.id}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
