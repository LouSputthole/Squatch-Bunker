import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId } = await params;
  const body = await req.json();

  try {
    const { prisma } = await import("@/lib/db");
    const server = await prisma.server.findUnique({ where: { id: serverId } });
    if (!server) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (server.ownerId !== session.userId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const data: { banner?: string | null; name?: string } = {};
    if ("banner" in body) data.banner = body.banner || null;
    if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();

    const updated = await prisma.server.update({
      where: { id: serverId },
      data,
      include: { channels: true, _count: { select: { members: true } } },
    });
    return NextResponse.json({ server: updated });
  } catch (err) {
    console.error("[Campfire] PATCH server:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
