import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { projectVisibleServerChannels } from "@/lib/channelAccess";
import { containsInsensitive } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** "YYYY-MM-DD" (the date picker's value) as UTC midnight, or null if invalid. */
function parseDay(value: string): Date | null {
  if (!DATE_ONLY.test(value)) return null;
  const day = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value ? null : day;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  const serverId = searchParams.get("serverId");

  if (!query || query.length > 100 || !serverId) {
    return NextResponse.json({ error: "q and serverId are required" }, { status: 400 });
  }

  // Optional SearchPanel filters: author name, and an inclusive day range.
  const user = searchParams.get("user")?.trim().replace(/^@/, "") || null;
  if (user && user.length > 64) {
    return NextResponse.json({ error: "user filter is too long" }, { status: 400 });
  }
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  // Days are the searcher's local days: `tz` is their Date#getTimezoneOffset() in minutes.
  const tzParam = searchParams.get("tz");
  const tzOffsetMs = tzParam === null ? 0 : Number(tzParam) * 60_000;
  if (!Number.isInteger(Number(tzParam ?? 0)) || Math.abs(tzOffsetMs) > 14 * 60 * 60_000) {
    return NextResponse.json({ error: "tz must be a minute offset" }, { status: 400 });
  }
  const fromDay = fromParam ? parseDay(fromParam) : null;
  const toDay = toParam ? parseDay(toParam) : null;
  if ((fromParam && !fromDay) || (toParam && !toDay)) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD dates" }, { status: 400 });
  }
  const from = fromDay ? new Date(fromDay.getTime() + tzOffsetMs) : null;
  const before = toDay ? new Date(toDay.getTime() + DAY_MS + tzOffsetMs) : null;
  if (from && before && from >= before) {
    return NextResponse.json({ error: "from must not be after to" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    const server = await prisma.server.findUnique({
      where: { id: serverId },
      select: {
        id: true,
        channels: { select: { id: true } },
      },
    });
    if (!server) {
      return NextResponse.json({ error: "Not a server member" }, { status: 403 });
    }

    const [visibleServer] = await projectVisibleServerChannels(
      [server],
      session.userId,
    );
    if (!visibleServer) {
      return NextResponse.json({ error: "Not a server member" }, { status: 403 });
    }
    const visibleChannelIds = visibleServer.channels.map((channel) => channel.id);

    const messages = await prisma.message.findMany({
      where: {
        content: containsInsensitive(query),
        channelId: { in: visibleChannelIds },
        ...(user ? { author: { username: containsInsensitive(user) } } : {}),
        ...(from || before
          ? { createdAt: { ...(from ? { gte: from } : {}), ...(before ? { lt: before } : {}) } }
          : {}),
      },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        channel: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });

    return NextResponse.json({ results: messages });
  } catch (err) {
    console.error("[Campfire] Search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
