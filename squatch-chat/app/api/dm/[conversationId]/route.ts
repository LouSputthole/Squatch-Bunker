import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// GET — fetch messages for a conversation
export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { conversationId } = await params;
  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);

  try {
    const { prisma } = await import("@/lib/db");

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (conversation.user1Id !== session.userId && conversation.user2Id !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const messages = await prisma.directMessage.findMany({
      where: {
        conversationId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        author: { select: { id: true, username: true, avatar: true } },
      },
    });

    return NextResponse.json({ messages: messages.reverse() });
  } catch (err) {
    console.error("[Campfire] Failed to fetch DMs:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}

// POST — send a message in conversation
export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { conversationId } = await params;
  const { content, attachmentUrl, attachmentName } = await request.json();

  if (!content?.trim() && !attachmentUrl) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  try {
    const { prisma } = await import("@/lib/db");

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (conversation.user1Id !== session.userId && conversation.user2Id !== session.userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [message] = await prisma.$transaction([
      prisma.directMessage.create({
        data: {
          conversationId,
          authorId: session.userId,
          content: content?.trim() || "",
          attachmentUrl,
          attachmentName,
        },
        include: {
          author: { select: { id: true, username: true, avatar: true } },
        },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ message });
  } catch (err) {
    console.error("[Campfire] Failed to send DM:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
