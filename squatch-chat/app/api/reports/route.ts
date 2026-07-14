import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkWeightedLimit } from "@/lib/rateLimit";

import { resolveChannelAccess } from "@/lib/channelAccess";
const MAX_REASON = 1000;
const MIN_REASON = 10;
const REPORTS_PER_HOUR = 5;

/**
 * POST /api/reports — flag a user (optionally a specific message) for the
 * instance operator. v1 intentionally has no read API: reports are for the
 * operator, not other users, and the operator reads the table directly.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const limit = checkWeightedLimit(`report:${session.userId}`, 1, REPORTS_PER_HOUR, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many reports. Try again later." }, { status: 429 });
  }

  let body: { targetUserId?: unknown; messageId?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId : "";
  const messageId = typeof body.messageId === "string" ? body.messageId : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!targetUserId) {
    return NextResponse.json({ error: "targetUserId is required" }, { status: 400 });
  }
  if (targetUserId === session.userId) {
    return NextResponse.json({ error: "You can't report yourself" }, { status: 400 });
  }
  if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
    return NextResponse.json(
      { error: `Reason must be ${MIN_REASON}-${MAX_REASON} characters` },
      { status: 400 },
    );
  }

  if (messageId) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { authorId: true, channelId: true },
    });
    if (!message || message.authorId !== targetUserId) {
      return NextResponse.json({ error: "Message not found for that user" }, { status: 404 });
    }
    const access = await resolveChannelAccess(message.channelId, session.userId);
    if (!access?.canView) {
      return NextResponse.json({ error: "Message not found for that user" }, { status: 404 });
    }
  } else {
    // User-level reports must stay inside a community shared by both people.
    // This also avoids turning the endpoint into a global user-ID oracle.
    const sharedServer = await prisma.server.findFirst({
      where: {
        AND: [
          {
            OR: [
              { ownerId: session.userId },
              { members: { some: { userId: session.userId, banned: false } } },
            ],
          },
          {
            OR: [
              { ownerId: targetUserId },
              { members: { some: { userId: targetUserId, banned: false } } },
            ],
          },
        ],
      },
      select: { id: true },
    });
    if (!sharedServer) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
  }

  // One open report per reporter+target(+message) — repeat submissions are
  // noise for the operator, not signal.
  const existing = await prisma.report.findFirst({
    where: { reporterId: session.userId, targetUserId, messageId, status: "open" },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: "You already have an open report for this" }, { status: 409 });
  }

  const report = await prisma.report.create({
    data: { reporterId: session.userId, targetUserId, messageId, reason },
    select: { id: true, createdAt: true },
  });

  return NextResponse.json({ report }, { status: 201 });
}
