import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { messageId } = await params;
  const { emoji } = await req.json();

  if (!emoji || typeof emoji !== "string") {
    return NextResponse.json({ error: "Emoji required" }, { status: 400 });
  }

  try {
    // Check if reaction already exists — toggle it off
    const existing = await prisma.reaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId: session.userId,
          emoji,
        },
      },
    });

    if (existing) {
      await prisma.reaction.delete({ where: { id: existing.id } });
    } else {
      await prisma.reaction.create({
        data: {
          messageId,
          userId: session.userId,
          emoji,
        },
      });
    }

    // Return updated reactions for this message
    const reactions = await prisma.reaction.findMany({
      where: { messageId },
      select: {
        emoji: true,
        userId: true,
        user: { select: { username: true } },
      },
    });

    // Group by emoji
    const grouped = reactions.reduce<Record<string, { count: number; users: string[]; userIds: string[] }>>((acc, r) => {
      if (!acc[r.emoji]) acc[r.emoji] = { count: 0, users: [], userIds: [] };
      acc[r.emoji].count++;
      acc[r.emoji].users.push(r.user.username);
      acc[r.emoji].userIds.push(r.userId);
      return acc;
    }, {});

    return NextResponse.json({ reactions: grouped });
  } catch (err) {
    console.error("[Campfire] Reaction error:", err);
    return NextResponse.json({ error: "Failed to react" }, { status: 500 });
  }
}
