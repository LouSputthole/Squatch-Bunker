import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { memberHasPermission } from "@/lib/serverRoles";

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { channelIds, serverId } = await req.json();

  if (!Array.isArray(channelIds) || !serverId) {
    return NextResponse.json({ error: "channelIds array and serverId required" }, { status: 400 });
  }

  if (!(await memberHasPermission(serverId, session.userId, "MANAGE_CHANNELS"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Update positions in a transaction
  await prisma.$transaction(
    channelIds.map((id: string, index: number) =>
      prisma.channel.updateMany({
        where: { id, serverId }, // serverId check for security
        data: { position: index },
      })
    )
  );

  return NextResponse.json({ ok: true });
}
