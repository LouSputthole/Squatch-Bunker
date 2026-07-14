import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/membership";
import { memberHasPermission } from "@/lib/serverRoles";
import { gatheringResponseForViewer } from "@/lib/gatheringAccess";
import {
  gatheringTiming,
  parseRsvpStatus,
} from "@/lib/gatherings";

const gatheringInclude = {
  channel: { select: { id: true, name: true, type: true } },
  creator: { select: { id: true, username: true, avatar: true } },
  rsvps: { select: { userId: true, status: true } },
} as const;

async function loadAvailableGathering(gatheringId: string, userId: string) {
  const gathering = await prisma.gathering.findUnique({
    where: { id: gatheringId },
    select: {
      id: true,
      serverId: true,
      startsAt: true,
      durationMinutes: true,
    },
  });
  if (!gathering) {
    return { ok: false as const, status: 404, error: "Gathering not found" };
  }
  if (!(await requireMembership(gathering.serverId, userId))) {
    return { ok: false as const, status: 403, error: "Not a server member" };
  }
  if (gatheringTiming(gathering.startsAt, gathering.durationMinutes).phase === "ended") {
    return { ok: false as const, status: 409, error: "This gathering has ended" };
  }
  return { ok: true as const, gathering };
}

async function responseForViewer(
  gatheringId: string,
  serverId: string,
  userId: string,
) {
  const [gathering, canManageServer] = await Promise.all([
    prisma.gathering.findUniqueOrThrow({
      where: { id: gatheringId },
      include: gatheringInclude,
    }),
    memberHasPermission(serverId, userId, "MANAGE_SERVER"),
  ]);
  return gatheringResponseForViewer(
    gathering,
    userId,
    canManageServer,
  );
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ gatheringId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { gatheringId } = await params;
  const access = await loadAvailableGathering(gatheringId, session.userId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const status = parseRsvpStatus(body.status);
  if (!status) {
    return NextResponse.json(
      { error: "RSVP status must be going, maybe, or declined" },
      { status: 400 },
    );
  }

  await prisma.gatheringRsvp.upsert({
    where: { gatheringId_userId: { gatheringId, userId: session.userId } },
    create: { gatheringId, userId: session.userId, status },
    update: { status },
  });

  return NextResponse.json({
    gathering: await responseForViewer(
      gatheringId,
      access.gathering.serverId,
      session.userId,
    ),
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ gatheringId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { gatheringId } = await params;
  const access = await loadAvailableGathering(gatheringId, session.userId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  await prisma.gatheringRsvp.deleteMany({
    where: { gatheringId, userId: session.userId },
  });
  return NextResponse.json({
    gathering: await responseForViewer(
      gatheringId,
      access.gathering.serverId,
      session.userId,
    ),
  });
}
