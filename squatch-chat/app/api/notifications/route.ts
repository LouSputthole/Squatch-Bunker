import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const PAGE_SIZE = 50;
const MAX_MARK_IDS = 100;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const cursor = new URL(request.url).searchParams.get("cursor");
  const { prisma } = await import("@/lib/db");

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: session.userId },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    prisma.notification.count({
      where: { userId: session.userId, readAt: null },
    }),
  ]);

  return NextResponse.json({
    notifications,
    unreadCount,
    nextCursor: notifications.length === PAGE_SIZE
      ? notifications[notifications.length - 1].id
      : null,
  });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { ids, all } = (body ?? {}) as { ids?: unknown; all?: unknown };

  const markAll = all === true;
  const markIds = Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string").slice(0, MAX_MARK_IDS)
    : [];
  if (!markAll && markIds.length === 0) {
    return NextResponse.json({ error: "Nothing to mark" }, { status: 400 });
  }

  const { prisma } = await import("@/lib/db");
  const result = await prisma.notification.updateMany({
    where: {
      userId: session.userId,
      readAt: null,
      ...(markAll ? {} : { id: { in: markIds } }),
    },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ marked: result.count });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { prisma } = await import("@/lib/db");
  const result = await prisma.notification.deleteMany({
    where: { userId: session.userId },
  });
  return NextResponse.json({ deleted: result.count });
}
