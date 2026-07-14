import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { assertFeature } from "@/lib/features";

export async function GET(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { channelId } = await params;
  const access = await resolveChannelAccess(channelId, session.userId);
  if (!access?.canView) {
    return NextResponse.json({ error: "No access to this channel" }, { status: 403 });
  }


  const messages = await prisma.scheduledMessage.findMany({
    where: { channelId, authorId: session.userId, sent: false },
    orderBy: { sendAt: "asc" },
  });
  return NextResponse.json({ messages });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { channelId } = await params;

  // Scheduling is deferred publication, so it requires the same effective
  // channel send permission as an immediate message.
  const access = await resolveChannelAccess(channelId, session.userId);
  if (!access?.canSend) {
    return NextResponse.json({ error: "No access to this channel" }, { status: 403 });
  }

  // Premium feature gate
  if (!(await assertFeature(session.userId, "scheduled_messages"))) {
    return NextResponse.json({ error: "Upgrade required" }, { status: 403 });
  }

  const { content, sendAt } = await req.json();
  if (!content?.trim() || !sendAt) {
    return NextResponse.json({ error: "content and sendAt required" }, { status: 400 });
  }

  const sendAtDate = new Date(sendAt);
  if (sendAtDate <= new Date()) {
    return NextResponse.json({ error: "sendAt must be in the future" }, { status: 400 });
  }

  const msg = await prisma.scheduledMessage.create({
    data: { channelId, authorId: session.userId, content: content.trim(), sendAt: sendAtDate },
  });

  return NextResponse.json({ message: msg });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await prisma.scheduledMessage.deleteMany({
    where: { id, authorId: session.userId },
  });

  return NextResponse.json({ ok: true });
}
