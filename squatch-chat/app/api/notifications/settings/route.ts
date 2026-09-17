import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const MINUTES_PER_DAY = 24 * 60;

function isMinuteOfDay(value: unknown): value is number {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= 0
    && value < MINUTES_PER_DAY;
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { quietHoursStart: true, quietHoursEnd: true },
  });
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json(user);
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
  const { quietHoursStart, quietHoursEnd } = (body ?? {}) as {
    quietHoursStart?: unknown;
    quietHoursEnd?: unknown;
  };

  // Quiet hours are set or cleared as a pair; minutes are in the user's local
  // clock and evaluated client-side, so no timezone is stored.
  const clearing = quietHoursStart === null && quietHoursEnd === null;
  const setting = isMinuteOfDay(quietHoursStart) && isMinuteOfDay(quietHoursEnd);
  if (!clearing && !setting) {
    return NextResponse.json(
      { error: "Provide quietHoursStart and quietHoursEnd as minutes 0-1439, or both null" },
      { status: 400 },
    );
  }

  const { prisma } = await import("@/lib/db");
  const user = await prisma.user.update({
    where: { id: session.userId },
    data: {
      quietHoursStart: clearing ? null : (quietHoursStart as number),
      quietHoursEnd: clearing ? null : (quietHoursEnd as number),
    },
    select: { quietHoursStart: true, quietHoursEnd: true },
  });
  return NextResponse.json(user);
}
