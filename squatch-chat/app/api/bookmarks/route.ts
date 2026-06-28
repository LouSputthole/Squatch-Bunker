import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requireChannelMembership } from "@/lib/membership";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { prisma } = await import("@/lib/db");
    const bookmarks = await prisma.bookmark.findMany({
      where: { userId: session.userId },
      include: {
        message: {
          include: { author: { select: { id: true, username: true, avatar: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Only return bookmarks whose message the caller can still access (active,
    // non-banned member of the message's channel/server). This prevents leaking
    // message content for servers the user has left or been banned from.
    const accessible: typeof bookmarks = [];
    for (const bookmark of bookmarks) {
      if (
        bookmark.message &&
        (await requireChannelMembership(bookmark.message.channelId, session.userId))
      ) {
        accessible.push(bookmark);
      }
    }
    return NextResponse.json({ bookmarks: accessible });
  } catch (err) {
    console.error("[Campfire] GET bookmarks:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { messageId } = await req.json();
    if (!messageId || typeof messageId !== "string") {
      return NextResponse.json({ error: "messageId is required" }, { status: 400 });
    }
    const { prisma } = await import("@/lib/db");

    // Authorization: only bookmark a message the caller can actually access
    // (active, non-banned member of its channel's server).
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { channelId: true },
    });
    if (!message) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }
    const access = await requireChannelMembership(message.channelId, session.userId);
    if (!access) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const bookmark = await prisma.bookmark.upsert({
      where: { userId_messageId: { userId: session.userId, messageId } },
      create: { userId: session.userId, messageId },
      update: {},
    });
    return NextResponse.json({ bookmark }, { status: 201 });
  } catch (err) {
    console.error("[Campfire] POST bookmark:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const { messageId } = await req.json();
    const { prisma } = await import("@/lib/db");
    await prisma.bookmark.deleteMany({
      where: { userId: session.userId, messageId },
    });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("[Campfire] DELETE bookmark:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
