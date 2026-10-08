import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// POST — mark the other participant's messages in this conversation as read.
// Participant-only; it only ever touches messages addressed to the caller.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { conversationId } = await params;

  try {
    const { prisma } = await import("@/lib/db");
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { user1Id: true, user2Id: true },
    });
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (conversation.user1Id !== session.userId && conversation.user2Id !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { count } = await prisma.directMessage.updateMany({
      where: {
        conversationId,
        authorId: { not: session.userId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ marked: count });
  } catch (err) {
    console.error("[Campfire] Failed to mark DMs read:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
