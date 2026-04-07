import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rateLimit";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const parentId = searchParams.get("parentId");
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
      where: { channelId, parentMessageId: parentId ?? null },
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

  const { allowed, remaining, resetAt } = checkRateLimit(`msg:${session.userId}`);
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": String(30),
          "X-RateLimit-Remaining": String(remaining),
          "X-RateLimit-Reset": String(Math.ceil(resetAt / 1000)),
          "Retry-After": String(Math.ceil((resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  const { channelId, content, attachmentUrl, attachmentName, replyToId, parentMessageId } = await request.json();
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
      select: { serverId: true, slowModeSeconds: true },
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

    // Slow mode check
    if (channel.slowModeSeconds > 0) {
      const lastMessage = await prisma.message.findFirst({
        where: { channelId, authorId: session.userId },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      if (lastMessage) {
        const elapsed = (Date.now() - new Date(lastMessage.createdAt).getTime()) / 1000;
        const remaining = Math.ceil(channel.slowModeSeconds - elapsed);
        if (remaining > 0) {
          return NextResponse.json(
            { error: `Slow mode: wait ${remaining} seconds`, remaining },
            { status: 429 }
          );
        }
      }
    }

    const message = await prisma.message.create({
      data: {
        channelId,
        authorId: session.userId,
        content: content?.trim() || "",
        ...(attachmentUrl ? { attachmentUrl, attachmentName } : {}),
        ...(replyToId ? { replyToId } : {}),
        ...(parentMessageId ? { parentMessageId } : {}),
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
