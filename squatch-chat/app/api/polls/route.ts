import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveChannelAccess } from "@/lib/channelAccess";
import { parsePollDraft } from "@/lib/polls";

const pollInclude = {
  options: {
    orderBy: { position: "asc" as const },
    include: { votes: { select: { userId: true } } },
  },
  votes: { select: { userId: true, optionId: true } },
};

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const channelId = body && typeof body.channelId === "string" ? body.channelId : "";
  const draft = parsePollDraft(body);
  if (!channelId || !draft) {
    return NextResponse.json({ error: "Provide a question and 2-10 unique options" }, { status: 400 });
  }

  const access = await resolveChannelAccess(channelId, session.userId);
  if (!access?.canSend) {
    return NextResponse.json({ error: "Not authorized to create a poll here" }, { status: 403 });
  }

  const { prisma } = await import("@/lib/db");
  const result = await prisma.$transaction(async (tx) => {
    const message = await tx.message.create({
      data: {
        channelId,
        authorId: session.userId,
        content: `Camp Vote: ${draft.question}`,
      },
    });
    const poll = await tx.poll.create({
      data: {
        serverId: access.serverId,
        channelId,
        messageId: message.id,
        creatorId: session.userId,
        question: draft.question,
        allowMultiple: draft.allowMultiple,
        closesAt: draft.closesAt,
        options: { create: draft.options.map((text, position) => ({ text, position })) },
      },
      include: pollInclude,
    });
    const hydratedMessage = await tx.message.findUniqueOrThrow({
      where: { id: message.id },
      include: {
        author: { select: { id: true, username: true, avatar: true } },
        poll: { include: pollInclude },
      },
    });
    return { poll, message: hydratedMessage };
  });

  return NextResponse.json(result, { status: 201 });
}
