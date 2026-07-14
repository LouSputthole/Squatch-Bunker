import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getPermContext } from "@/lib/serverRoles";
import { hasPermission } from "@/lib/permissions";

// DELETE — remove a sound. The uploader can delete their own; otherwise needs MANAGE_EMOJIS.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ serverId: string; soundId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { serverId, soundId } = await params;

  const sound = await prisma.sound.findUnique({ where: { id: soundId } });
  if (!sound || sound.serverId !== serverId) return NextResponse.json({ error: "Sound not found" }, { status: 404 });

  const ctx = await getPermContext(serverId, session.userId);
  if (!ctx.isMember) {
    return NextResponse.json({ error: "Not a server member" }, { status: 403 });
  }
  const isUploader = sound.createdBy === session.userId;
  if (!isUploader && !hasPermission("MANAGE_EMOJIS", ctx)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  await prisma.sound.delete({ where: { id: soundId } });
  return NextResponse.json({ ok: true });
}
