import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ message });
  } catch (err) {
    console.error("[Campfire] Failed to fetch message:", err);
    return NextResponse.json({ error: "Failed to fetch message" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { messageId } = await params;
  const body = await request.json();

  try {
    const { prisma } = await import("@/lib/db");

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: {
        authorId: true,
        channelId: true,
        channel: { select: { serverId: true, server: { select: { ownerId: true } } } },
      },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Handle pin toggle — allowed for server owner, admin, and mod
    if ("pinned" in body) {
      const membership = await prisma.serverMember.findUnique({
        where: { serverId_userId: { serverId: message.channel.serverId, userId: session.userId } },
      });
      const canPin =
        message.channel.server.ownerId === session.userId ||
        membership?.role === "admin" ||
        membership?.role === "mod";
      if (!canPin) {
        return NextResponse.json({ error: "No permission to pin" }, { status: 403 });
      }
      const updated = await prisma.message.update({
        where: { id: messageId },
        data: { pinned: !!body.pinned },
        include: { author: { select: { id: true, username: true, avatar: true } } },
      });
      return NextResponse.json({ message: updated });
    }

    // Handle content edit — author only
    const { content } = body;
    if (!content || !content.trim()) {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }
    if (message.authorId !== session.userId) {
      return NextResponse.json({ error: "Not your message" }, { status: 403 });
    }
    const updated = await prisma.message.update({
      where: { id: messageId },
      data: { content: content.trim() },
      include: { author: { select: { id: true, username: true, avatar: true } } },
    });
    return NextResponse.json({ message: updated });
  } catch (err) {
    console.error("[Campfire] Failed to edit message:", err);
    return NextResponse.json({ error: "Failed to edit message" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { messageId } = await params;

  try {
    const { prisma } = await import("@/lib/db");

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { authorId: true, channelId: true, channel: { select: { server: { select: { ownerId: true } } } } },
    });

    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Author or server owner can delete
    const isAuthor = message.authorId === session.userId;
    const isServerOwner = message.channel.server.ownerId === session.userId;

    if (!isAuthor && !isServerOwner) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    await prisma.message.delete({ where: { id: messageId } });

    return NextResponse.json({ deleted: true, messageId, channelId: message.channelId });
  } catch (err) {
    console.error("[Campfire] Failed to delete message:", err);
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 });
  }
}
