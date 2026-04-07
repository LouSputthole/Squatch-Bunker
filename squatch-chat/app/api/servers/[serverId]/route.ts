import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    // Only owner can update server settings
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      return NextResponse.json({ error: "Server not found" }, { status: 404 });
    }
    if (server.ownerId !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const data: { icon?: string; name?: string } = {};
    if (typeof body.icon === "string") data.icon = body.icon || null as unknown as string;
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();

    const updated = await prisma.server.update({
      where: { id: serverId },
      data,
      include: { channels: true, _count: { select: { members: true } } },
    });

    return NextResponse.json({ server: updated });
  } catch (err) {
    console.error("[Campfire] Failed to update server:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
