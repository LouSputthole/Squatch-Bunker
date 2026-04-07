import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

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
    return NextResponse.json({ bookmarks });
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
    const { prisma } = await import("@/lib/db");
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
