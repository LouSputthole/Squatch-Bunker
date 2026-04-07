import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Simple security: require a secret token
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.SCHEDULER_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const pending = await prisma.scheduledMessage.findMany({
    where: { sent: false, sendAt: { lte: now } },
    take: 100,
  });

  let sent = 0;
  for (const scheduled of pending) {
    try {
      await prisma.$transaction([
        prisma.message.create({
          data: {
            channelId: scheduled.channelId,
            authorId: scheduled.authorId,
            content: scheduled.content,
          },
        }),
        prisma.scheduledMessage.update({
          where: { id: scheduled.id },
          data: { sent: true },
        }),
      ]);
      sent++;
    } catch { /* continue */ }
  }

  return NextResponse.json({ processed: sent });
}
