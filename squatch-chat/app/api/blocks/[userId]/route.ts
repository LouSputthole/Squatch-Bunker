import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { removeUserBlock } from "@/lib/userBlocks";

interface BlockRouteContext {
  params: Promise<{ userId: string }>;
}

export async function GET(_request: Request, { params }: BlockRouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { userId } = await params;
  const block = await prisma.userBlock.findUnique({
    where: {
      blockerId_blockedId: {
        blockerId: session.userId,
        blockedId: userId,
      },
    },
    select: { id: true },
  });

  return NextResponse.json({ blocked: block !== null });
}

export async function DELETE(_request: Request, { params }: BlockRouteContext) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { userId } = await params;
  await removeUserBlock(session.userId, userId);
  return NextResponse.json({ ok: true });
}
