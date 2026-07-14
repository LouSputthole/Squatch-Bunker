import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { normalizeJournalNote } from "@/lib/journal";
import {
  removeUnreferencedPrivateUpload,
  removeUnreferencedUpload,
} from "@/lib/messageRetention";
import { requireMembership } from "@/lib/membership";

export async function GET(_request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { serverId } = await params;
  if (!await requireMembership(serverId, session.userId)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const { prisma } = await import("@/lib/db");
  const entries = await prisma.journalEntry.findMany({
    where: { serverId, authorId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      sourceMessage: { select: { channelId: true, author: { select: { id: true, username: true } } } },
    },
  });
  return NextResponse.json({ entries });
}

export async function POST(request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { serverId } = await params;
  if (!await requireMembership(serverId, session.userId)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const messageId = body && typeof body.messageId === "string" ? body.messageId : "";
  const rawNote = body?.note;
  const note = normalizeJournalNote(rawNote);
  if (!messageId || (rawNote !== undefined && rawNote !== null && rawNote !== "" && !note)) {
    return NextResponse.json({ error: "Provide a valid message and a note under 500 characters" }, { status: 400 });
  }

  const { prisma } = await import("@/lib/db");
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      channelId: true,
      content: true,
      attachmentUrl: true,
      attachmentName: true,
      privateUploadId: true,
      channel: { select: { serverId: true } },
    },
  });
  if (!message || message.channel.serverId !== serverId) {
    return NextResponse.json({ error: "Message not found in this camp" }, { status: 404 });
  }
  const access = await resolveChannelAccess(message.channelId, session.userId);
  if (!access?.canView) return NextResponse.json({ error: "Not authorized" }, { status: 403 });

  const entry = await prisma.journalEntry.create({
    data: {
      serverId,
      authorId: session.userId,
      sourceMessageId: message.id,
      content: message.content,
      attachmentUrl: message.attachmentUrl,
      attachmentName: message.attachmentName,
      privateUploadId: message.privateUploadId,
      note,
    },
  });
  return NextResponse.json({ entry }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ serverId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { serverId } = await params;
  if (!await requireMembership(serverId, session.userId)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }
  const entryId = new URL(request.url).searchParams.get("entryId");
  if (!entryId) return NextResponse.json({ error: "entryId is required" }, { status: 400 });
  const { prisma } = await import("@/lib/db");
  const entry = await prisma.journalEntry.findFirst({
    where: { id: entryId, serverId, authorId: session.userId },
    select: { id: true, attachmentUrl: true, privateUploadId: true },
  });
  if (!entry) return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
  const result = await prisma.journalEntry.deleteMany({ where: { id: entryId, serverId, authorId: session.userId } });
  if (!result.count) return NextResponse.json({ error: "Journal entry not found" }, { status: 404 });
  await Promise.all([
    entry.attachmentUrl
      ? removeUnreferencedUpload(entry.attachmentUrl)
      : Promise.resolve(),
    entry.privateUploadId
      ? removeUnreferencedPrivateUpload(entry.privateUploadId)
      : Promise.resolve(),
  ]);
  return NextResponse.json({ success: true });
}
