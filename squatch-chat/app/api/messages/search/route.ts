import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q")?.trim();
  const serverId = searchParams.get("serverId");

  if (!query || !serverId) {
    return NextResponse.json({ error: "q and serverId are required" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    // Verify membership
    const membership = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: session.userId } },
    });
    if (!membership) {
      return NextResponse.json({ error: "Not a server member" }, { status: 403 });
    }

    const messages = await prisma.message.findMany({
      where: {
        content: { contains: query, mode: "insensitive" },
        channel: { serverId },
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
