import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { channelId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      include: { server: { select: { ownerId: true } } },
    });

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    if (channel.server.ownerId !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const messages = await prisma.message.findMany({
      where: { channelId },
      include: { author: { select: { username: true, id: true } } },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      channel: { id: channel.id, name: channel.name },
      messages,
    });
  } catch (err) {
    console.error("[Campfire] Failed to export channel messages:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
