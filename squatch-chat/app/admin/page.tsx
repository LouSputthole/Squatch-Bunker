import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

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
  if (!session) redirect("/");

  const { prisma } = await import("@/lib/db");

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [totalUsers, totalServers, totalMessages, recentMessages, topServers, topChannels] =
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
    ]);

  // Group messages by day
  const dayCounts: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dayCounts[key] = 0;
  }
  for (const msg of recentMessages) {
    const key = msg.createdAt.toISOString().slice(0, 10);
    if (key in dayCounts) dayCounts[key]++;
  }
  const messagesPerDay = Object.entries(dayCounts).map(([date, count]) => ({
    label: date.slice(5), // MM-DD
    value: count,
  }));

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
  ];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] p-8">
      <h1 className="text-2xl font-bold mb-2">Admin Dashboard</h1>
      <p className="text-sm text-[var(--muted)] mb-8">
        Logged in as <strong>{session.username}</strong>
      </p>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
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
    </div>
  );
}
