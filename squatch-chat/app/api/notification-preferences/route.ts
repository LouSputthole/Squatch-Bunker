import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { prisma } = await import("@/lib/db");
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId: session.userId },
    });
    return NextResponse.json({ preferences });
  } catch (err) {
    console.error("[Campfire] Failed to fetch notification preferences:", err);
    return NextResponse.json({ preferences: [] });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId, channelId, level } = await request.json();

  if (!level) {
    return NextResponse.json({ error: "level is required" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");
    const preference = await prisma.notificationPreference.upsert({
      where: {
        userId_serverId_channelId: {
          userId: session.userId,
          serverId: serverId ?? null,
          channelId: channelId ?? null,
        },
      },
      update: { level },
      create: {
        userId: session.userId,
        serverId: serverId ?? null,
        channelId: channelId ?? null,
        level,
      },
    });
    return NextResponse.json({ preference }, { status: 200 });
  } catch (err) {
    console.error("[Campfire] Failed to upsert notification preference:", err);
    return NextResponse.json(
      { error: "Database not available. Please check your PostgreSQL connection." },
      { status: 503 }
    );
  }
}
