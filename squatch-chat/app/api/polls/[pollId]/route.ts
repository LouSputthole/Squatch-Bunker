import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { isPollClosed } from "@/lib/polls";
import { memberHasPermission } from "@/lib/serverRoles";

const includePoll = {
  options: {
    orderBy: { position: "asc" as const },
    include: { votes: { select: { userId: true } } },
  },
  votes: { select: { userId: true, optionId: true } },
};

const MAX_SERIALIZABLE_VOTE_ATTEMPTS = 3;

function isSerializationConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === "P2034";
}

async function findVisiblePoll(pollId: string, userId: string) {
  const { prisma } = await import("@/lib/db");
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, include: includePoll });
  if (!poll) return { poll: null, access: null };
  const access = await resolveChannelAccess(poll.channelId, userId);
  return { poll, access };
}

export async function GET(_request: Request, { params }: { params: Promise<{ pollId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { pollId } = await params;
  const { poll, access } = await findVisiblePoll(pollId, session.userId);
  if (!poll) return NextResponse.json({ error: "Poll not found" }, { status: 404 });
  if (!access?.canView) return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  return NextResponse.json({ poll });
}

export async function POST(request: Request, { params }: { params: Promise<{ pollId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { pollId } = await params;
  const body = await request.json().catch(() => null);
  const optionId = body && typeof body.optionId === "string" ? body.optionId : "";
  const { poll, access } = await findVisiblePoll(pollId, session.userId);
  if (!poll) return NextResponse.json({ error: "Poll not found" }, { status: 404 });
  if (!access?.canSend) return NextResponse.json({ error: "Not authorized to vote here" }, { status: 403 });
  if (isPollClosed(poll)) return NextResponse.json({ error: "This poll is closed" }, { status: 409 });
  if (!poll.options.some((option) => option.id === optionId)) {
    return NextResponse.json({ error: "That option does not belong to this poll" }, { status: 400 });
  }

  const { prisma } = await import("@/lib/db");
  const runVoteTransaction = (serializable: boolean) => prisma.$transaction(async (tx) => {
    const existing = await tx.pollVote.findUnique({
      where: { optionId_userId: { optionId, userId: session.userId } },
      select: { id: true },
    });
    if (existing) {
      await tx.pollVote.delete({ where: { id: existing.id } });
      return;
    }
    if (!poll.allowMultiple) {
      await tx.pollVote.deleteMany({ where: { pollId, userId: session.userId } });
    }
    await tx.pollVote.create({ data: { pollId, optionId, userId: session.userId } });
  }, serializable ? { isolationLevel: "Serializable" } : undefined);

  if (poll.allowMultiple) {
    await runVoteTransaction(false);
  } else {
    // Concurrent choices are a write-skew on PostgreSQL: each request can see
    // no ballot, then insert a different option. Serializable aborts one whole
    // delete-and-insert transaction; retrying re-evaluates the winning ballot.
    for (let attempt = 1; attempt <= MAX_SERIALIZABLE_VOTE_ATTEMPTS; attempt += 1) {
      try {
        await runVoteTransaction(true);
        break;
      } catch (error) {
        if (!isSerializationConflict(error) || attempt === MAX_SERIALIZABLE_VOTE_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  const updated = await prisma.poll.findUniqueOrThrow({ where: { id: pollId }, include: includePoll });
  return NextResponse.json({ poll: updated });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ pollId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { pollId } = await params;
  const { poll, access } = await findVisiblePoll(pollId, session.userId);
  if (!poll) return NextResponse.json({ error: "Poll not found" }, { status: 404 });
  const canModerate = access
    ? await memberHasPermission(access.serverId, session.userId, "MANAGE_MESSAGES")
    : false;
  if (!access || (poll.creatorId !== session.userId && !canModerate)) {
    return NextResponse.json({ error: "Only the creator or a moderator can close this poll" }, { status: 403 });
  }
  const { prisma } = await import("@/lib/db");
  const updated = await prisma.poll.update({ where: { id: pollId }, data: { closedAt: poll.closedAt ?? new Date() }, include: includePoll });
  return NextResponse.json({ poll: updated });
}
