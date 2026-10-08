import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { projectVisibleServerChannels } from "@/lib/channelAccess";
import { parseServerName } from "@/lib/inputLimits";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { prisma } = await import("@/lib/db");
    const servers = await prisma.server.findMany({
      where: {
        members: { some: { userId: session.userId, banned: false } },
      },
      include: {
        channels: { orderBy: { createdAt: "asc" } },
        _count: { select: { members: { where: { banned: false } } } },
      },
      orderBy: { createdAt: "asc" },
    });

    const visibleServers = await projectVisibleServerChannels(
      servers,
      session.userId,
      prisma,
    );
    return NextResponse.json({ servers: visibleServers });
  } catch (err) {
    console.error("[Campfire] Failed to fetch servers:", err);
    return NextResponse.json(
      { error: "Unable to load servers" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const name = parseServerName(
    body && typeof body === "object" ? (body as Record<string, unknown>).name : undefined,
  );
  if (!name.ok) {
    return NextResponse.json({ error: name.error }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");
    const server = await prisma.server.create({
      data: {
        name: name.value,
        ownerId: session.userId,
        members: {
          create: { userId: session.userId, role: "owner" },
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
      { error: "Database unavailable. Check the server's database connection (DATABASE_URL)." },
      { status: 503 }
    );
  }
}
