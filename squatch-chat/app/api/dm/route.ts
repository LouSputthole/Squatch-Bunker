import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { usersHaveBlock } from "@/lib/userBlocks";
import { prismaErrorCode } from "@/lib/prismaErrors";

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
          select: { content: true, attachmentName: true, createdAt: true, authorId: true },
        },
        // Unread = the other participant's messages this user has not opened.
        _count: {
          select: {
            messages: { where: { authorId: { not: session.userId }, readAt: null } },
          },
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
        unreadCount: c._count.messages,
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

  const body: unknown = await request.json().catch(() => null);
  const targetUserId = body && typeof body === "object"
    ? (body as Record<string, unknown>).targetUserId
    : undefined;
  if (typeof targetUserId !== "string" || !targetUserId || targetUserId === session.userId) {
    return NextResponse.json({ error: "Invalid target user" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    if (await usersHaveBlock(session.userId, targetUserId)) {
      return NextResponse.json(
        { error: "Direct messages are unavailable between these users" },
        { status: 403 },
      );
    }

    // Ensure consistent ordering so unique constraint works
    const [u1, u2] = [session.userId, targetUserId].sort();

    const pair = { user1Id_user2Id: { user1Id: u1, user2Id: u2 } };
    let conversation = await prisma.conversation.findUnique({ where: pair });

    if (!conversation) {
      try {
        conversation = await prisma.conversation.create({
          data: { user1Id: u1, user2Id: u2 },
        });
      } catch (err) {
        // A concurrent request created the pair first: return that one.
        if (prismaErrorCode(err) !== "P2002") throw err;
        conversation = await prisma.conversation.findUniqueOrThrow({ where: pair });
      }
    }

    return NextResponse.json({ conversationId: conversation.id });
  } catch (err) {
    if (prismaErrorCode(err) === "P2003") {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    console.error("[Campfire] Failed to create DM:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
