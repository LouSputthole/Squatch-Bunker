import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireMembership } from "@/lib/membership";
import { memberHasPermission } from "@/lib/serverRoles";
import {
  gatheringResponseForViewer,
  validateGatheringLinkedChannel,
} from "@/lib/gatheringAccess";
import {
  GATHERING_MAX_DURATION_MINUTES,
  parseGatheringMutation,
} from "@/lib/gatherings";

const gatheringInclude = {
  channel: { select: { id: true, name: true, type: true } },
  creator: { select: { id: true, username: true, avatar: true } },
  rsvps: { select: { userId: true, status: true } },
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId } = await params;
  if (!(await requireMembership(serverId, session.userId))) {
    return NextResponse.json({ error: "Not a server member" }, { status: 403 });
  }

  const now = new Date();
  const earliestActiveStart = new Date(
    now.getTime() - GATHERING_MAX_DURATION_MINUTES * 60 * 1000,
  );
  const [gatherings, canManageServer] = await Promise.all([
    prisma.gathering.findMany({
      where: { serverId, startsAt: { gte: earliestActiveStart } },
      include: gatheringInclude,
      orderBy: { startsAt: "asc" },
      take: 100,
    }),
    memberHasPermission(serverId, session.userId, "MANAGE_SERVER"),
  ]);

  const responses = await Promise.all(
    gatherings.map((gathering) =>
      gatheringResponseForViewer(
        gathering,
        session.userId,
        canManageServer,
        now,
      ),
    ),
  );
  return NextResponse.json({
    gatherings: responses.filter((gathering) => gathering.phase !== "ended"),
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { serverId } = await params;
  if (!(await requireMembership(serverId, session.userId))) {
    return NextResponse.json({ error: "Not a server member" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseGatheringMutation(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const input = parsed.data;

  if (input.channelId) {
    const channelAccess = await validateGatheringLinkedChannel(
      input.channelId,
      serverId,
      session.userId,
    );
    if (!channelAccess.ok) {
      return NextResponse.json(
        { error: channelAccess.error },
        { status: channelAccess.status },
      );
    }
  }

  const gathering = await prisma.gathering.create({
    data: {
      serverId,
      creatorId: session.userId,
      title: input.title!,
      description: input.description ?? null,
      startsAt: input.startsAt!,
      durationMinutes: input.durationMinutes ?? 60,
      channelId: input.channelId ?? null,
    },
    include: gatheringInclude,
  });

  return NextResponse.json({
    gathering: await gatheringResponseForViewer(
      gathering,
      session.userId,
      false,
    ),
  }, { status: 201 });
}
