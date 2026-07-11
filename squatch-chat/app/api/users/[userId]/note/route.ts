import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;
  const note = await prisma.userNote.findUnique({
    where: { authorId_targetUserId: { authorId: session.userId, targetUserId: userId } },
  });

  return NextResponse.json({ note: note?.content ?? null });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId } = await params;
  const { content } = await req.json();

  if (typeof content !== "string") {
    return NextResponse.json({ error: "content must be a string" }, { status: 400 });
  }

  const trimmed = content.slice(0, 500);

  if (!trimmed) {
    await prisma.userNote.deleteMany({
      where: { authorId: session.userId, targetUserId: userId },
    });
    return NextResponse.json({ note: null });
  }

  const note = await prisma.userNote.upsert({
    where: { authorId_targetUserId: { authorId: session.userId, targetUserId: userId } },
    update: { content: trimmed },
    create: { authorId: session.userId, targetUserId: userId, content: trimmed },
  });

  return NextResponse.json({ note: note.content });
}
