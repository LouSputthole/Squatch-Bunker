import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createUserBlock } from "@/lib/userBlocks";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const blocks = await prisma.userBlock.findMany({
    where: { blockerId: session.userId },
    select: {
      id: true,
      createdAt: true,
      blocked: {
        select: { id: true, username: true, avatar: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    blocks: blocks.map((block) => ({
      id: block.id,
      user: block.blocked,
      createdAt: block.createdAt,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let userId: string | undefined;
  try {
    const body = (await request.json()) as { userId?: unknown };
    userId = typeof body.userId === "string" ? body.userId : undefined;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (userId === session.userId) {
    return NextResponse.json({ error: "You cannot block yourself" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const block = await createUserBlock(session.userId, userId);
  return NextResponse.json({ block });
}
