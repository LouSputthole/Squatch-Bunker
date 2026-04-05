import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { prisma } = await import("@/lib/db");
    const servers = await prisma.server.findMany({
      where: {
        members: { some: { userId: session.userId } },
      },
      include: {
        channels: { orderBy: { createdAt: "asc" } },
        _count: { select: { members: true } },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ servers });
  } catch (err) {
    console.error("[Campfire] Failed to fetch servers:", err);
    return NextResponse.json({ servers: [] });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { name } = await request.json();
  if (!name || !name.trim()) {
    return NextResponse.json(
      { error: "Server name is required" },
      { status: 400 }
    );
  }

  try {
    const { prisma } = await import("@/lib/db");
    const server = await prisma.server.create({
      data: {
        name: name.trim(),
        ownerId: session.userId,
        members: {
          create: { userId: session.userId },
        },
        channels: {
          create: { name: "campfire", type: "text" },
        },
      },
      include: {
        channels: true,
        _count: { select: { members: true } },
      },
    });

    return NextResponse.json({ server }, { status: 201 });
  } catch (err) {
    console.error("[Campfire] Failed to create server:", err);
    return NextResponse.json(
      { error: "Database not available. Please check your PostgreSQL connection." },
      { status: 503 }
    );
  }
}
