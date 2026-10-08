import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { prismaErrorCode } from "@/lib/prismaErrors";
import { getSession } from "@/lib/auth";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { MAX_REACTION_EMOJI_LENGTH } from "@/lib/inputLimits";
import { groupReactions } from "@/lib/messagePayload";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { messageId } = await params;
  const body: unknown = await req.json().catch(() => null);
  const emoji = body && typeof body === "object" ? (body as Record<string, unknown>).emoji : undefined;

  if (!emoji || typeof emoji !== "string") {
    return NextResponse.json({ error: "Emoji required" }, { status: 400 });
  }
  if (emoji.length > MAX_REACTION_EMOJI_LENGTH) {
    return NextResponse.json({ error: "Emoji is too long" }, { status: 400 });
  }

  try {
    // Authorization: caller must be able to access the message (i.e. be an
    // active, non-banned member of its channel's server) before reacting or
    // seeing the reactor identities returned below.
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true },
    });
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    const access = await resolveChannelAccess(message.channelId, session.userId);
    if (!access?.canSend) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

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

    // A double-click races two toggles. Losing either race is a no-op, not
    // an error: the reaction is already in the state that request wanted.
    if (existing) {
      await prisma.reaction.deleteMany({ where: { id: existing.id } });
    } else {
      await prisma.reaction.create({
        data: {
          messageId,
          userId: session.userId,
          emoji,
        },
      }).catch((error: unknown) => {
        if (prismaErrorCode(error) !== "P2002") throw error;
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

    return NextResponse.json({ reactions: groupReactions(reactions) });
  } catch (err) {
    console.error("[Campfire] Reaction error:", err);
    return NextResponse.json({ error: "Failed to react" }, { status: 500 });
  }
}
