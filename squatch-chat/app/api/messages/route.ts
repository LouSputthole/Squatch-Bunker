import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const cursor = searchParams.get("cursor");
  const limit = 50;

  if (!channelId) {
    return NextResponse.json(
      { error: "channelId is required" },
      { status: 400 }
    );
  }

  try {
    const { prisma } = await import("@/lib/db");

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const membership = await prisma.serverMember.findUnique({
      where: {
        serverId_userId: { serverId: channel.serverId, userId: session.userId },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Not a server member" }, { status: 403 });
    }

    const messages = await prisma.message.findMany({
      where: { channelId },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        reactions: {
          select: { emoji: true, userId: true, user: { select: { username: true } } },
        },
        replyTo: {
          select: {
            id: true,
            content: true,
            author: { select: { id: true, username: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    // Group reactions by emoji per message
    const messagesWithGroupedReactions = messages.map((m) => {
      const grouped: Record<string, { count: number; users: string[]; userIds: string[] }> = {};
      for (const r of m.reactions) {
        if (!grouped[r.emoji]) grouped[r.emoji] = { count: 0, users: [], userIds: [] };
        grouped[r.emoji].count++;
        grouped[r.emoji].users.push(r.user.username);
        grouped[r.emoji].userIds.push(r.userId);
      }
      return { ...m, reactions: grouped };
    });

    return NextResponse.json({
      messages: messagesWithGroupedReactions.reverse(),
      nextCursor: messages.length === limit ? messages[0]?.id : null,
    });
  } catch (err) {
    console.error("[Campfire] Failed to fetch messages:", err);
    return NextResponse.json({ messages: [], nextCursor: null });
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { channelId, content, attachmentUrl, attachmentName, replyToId } = await request.json();
  if (!channelId || (!content?.trim() && !attachmentUrl)) {
    return NextResponse.json(
      { error: "channelId and content or attachment are required" },
      { status: 400 }
    );
  }

  try {
    const { prisma } = await import("@/lib/db");

    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { serverId: true },
    });

    if (!channel) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    const membership = await prisma.serverMember.findUnique({
      where: {
        serverId_userId: { serverId: channel.serverId, userId: session.userId },
      },
    });

    if (!membership) {
      return NextResponse.json({ error: "Not a server member" }, { status: 403 });
    }

    const message = await prisma.message.create({
      data: {
        channelId,
        authorId: session.userId,
        content: content?.trim() || "",
        ...(attachmentUrl ? { attachmentUrl, attachmentName } : {}),
        ...(replyToId ? { replyToId } : {}),
      },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        replyTo: {
          select: {
            id: true,
            content: true,
            author: { select: { id: true, username: true } },
          },
        },
      },
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    console.error("[Campfire] Failed to save message:", err);
    return NextResponse.json(
      { error: "Database not available. Messages require PostgreSQL." },
      { status: 503 }
    );
  }
}
