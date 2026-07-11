import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// GET /api/dm — list conversations for current user
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const { prisma } = await import("@/lib/db");

    const conversations = await prisma.conversation.findMany({
      where: {
        OR: [{ user1Id: session.userId }, { user2Id: session.userId }],
      },
      include: {
        user1: { select: { id: true, username: true, avatar: true } },
        user2: { select: { id: true, username: true, avatar: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { content: true, createdAt: true, authorId: true },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    const result = conversations.map((c) => {
      const otherUser = c.user1Id === session.userId ? c.user2 : c.user1;
      const lastMessage = c.messages[0] || null;
      return {
        id: c.id,
        otherUser,
        lastMessage,
        updatedAt: c.updatedAt,
      };
    });

    return NextResponse.json({ conversations: result });
  } catch (err) {
    console.error("[Campfire] Failed to list DMs:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

// POST /api/dm — start or get existing conversation with a user
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { targetUserId } = await request.json();
  if (!targetUserId || targetUserId === session.userId) {
    return NextResponse.json({ error: "Invalid target user" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    // Ensure consistent ordering so unique constraint works
    const [u1, u2] = [session.userId, targetUserId].sort();

    let conversation = await prisma.conversation.findUnique({
      where: { user1Id_user2Id: { user1Id: u1, user2Id: u2 } },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { user1Id: u1, user2Id: u2 },
      });
    }

    return NextResponse.json({ conversationId: conversation.id });
  } catch (err) {
    console.error("[Campfire] Failed to create DM:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
