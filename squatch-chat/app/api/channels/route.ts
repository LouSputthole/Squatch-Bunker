import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId, name, type, description, category } = await request.json();
  if (!serverId || !name || !name.trim()) {
    return NextResponse.json(
      { error: "Server ID and channel name are required" },
      { status: 400 }
    );
  }

  const channelType = type === "voice" ? "voice" : "text";

  try {
    const { prisma } = await import("@/lib/db");

    const membership = await prisma.serverMember.findUnique({
      where: { serverId_userId: { serverId, userId: session.userId } },
    });

    if (!membership) {
      return NextResponse.json({ error: "Not a server member" }, { status: 403 });
    }

    const channel = await prisma.channel.create({
      data: {
        serverId,
        name: name.trim().toLowerCase().replace(/\s+/g, "-"),
        type: channelType,
        ...(description?.trim() ? { description: description.trim() } : {}),
        ...(category?.trim() ? { category: category.trim() } : {}),
      },
      select: {
        id: true,
        name: true,
        type: true,
        category: true,
        description: true,
        serverId: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ channel }, { status: 201 });
  } catch (err) {
    console.error("[Campfire] Failed to create channel:", err);
    return NextResponse.json(
      { error: "Database not available. Please check your PostgreSQL connection." },
      { status: 503 }
    );
  }
}
