import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/membership";
import { memberHasPermission } from "@/lib/serverRoles";
import {
  gatheringResponseForViewer,
  validateGatheringLinkedChannel,
} from "@/lib/gatheringAccess";
import { parseGatheringMutation } from "@/lib/gatherings";

const gatheringInclude = {
  channel: { select: { id: true, name: true, type: true } },
  creator: { select: { id: true, username: true, avatar: true } },
  rsvps: { select: { userId: true, status: true } },
} as const;

async function getGatheringAccess(gatheringId: string, userId: string) {
  const gathering = await prisma.gathering.findUnique({
    where: { id: gatheringId },
    select: { id: true, serverId: true, creatorId: true },
  });
  if (!gathering) {
    return { ok: false as const, status: 404, error: "Gathering not found" };
  }
  if (!(await requireMembership(gathering.serverId, userId))) {
    return { ok: false as const, status: 403, error: "Not a server member" };
  }

  const canManageServer = await memberHasPermission(
    gathering.serverId,
    userId,
    "MANAGE_SERVER",
  );
  if (gathering.creatorId !== userId && !canManageServer) {
    return {
      ok: false as const,
      status: 403,
      error: "Only the creator or a server manager can do this",
    };
  }

  return { ok: true as const, gathering, canManageServer };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ gatheringId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { gatheringId } = await params;
  const access = await getGatheringAccess(gatheringId, session.userId);
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
  const parsed = parseGatheringMutation(body, { partial: true });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (parsed.data.channelId) {
    const channelAccess = await validateGatheringLinkedChannel(
      parsed.data.channelId,
      access.gathering.serverId,
      session.userId,
    );
    if (!channelAccess.ok) {
      return NextResponse.json(
        { error: channelAccess.error },
        { status: channelAccess.status },
      );
    }
  }

  const gathering = await prisma.gathering.update({
    where: { id: gatheringId },
    data: parsed.data,
    include: gatheringInclude,
  });

  return NextResponse.json({
    gathering: await gatheringResponseForViewer(
      gathering,
      session.userId,
      access.canManageServer,
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
  const access = await getGatheringAccess(gatheringId, session.userId);
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }

  await prisma.gathering.delete({ where: { id: gatheringId } });
  return NextResponse.json({ ok: true });
}
