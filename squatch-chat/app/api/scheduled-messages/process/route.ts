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
      // Compare-and-set claim: only the worker that flips sent:false -> true
      // proceeds, so overlapping runs can't double-send the same row.
      const claim = await prisma.scheduledMessage.updateMany({
        where: { id: scheduled.id, sent: false },
        data: { sent: true },
      });
      if (claim.count === 0) continue; // already claimed/sent by another run

      // Re-validate the channel still exists; if it was deleted the message
      // can never be delivered, so drop the scheduled row instead of getting
      // permanently stuck retrying a failing insert.
      const channel = await prisma.channel.findUnique({
        where: { id: scheduled.channelId },
        select: { id: true },
      });
      if (!channel) {
        await prisma.scheduledMessage.delete({ where: { id: scheduled.id } });
        continue;
      }

      await prisma.message.create({
        data: {
          channelId: scheduled.channelId,
          authorId: scheduled.authorId,
          content: scheduled.content,
        },
      });
      sent++;
    } catch (err) {
      console.error("[Campfire] Failed to process scheduled message:", scheduled.id, err);
    }
  }

  return NextResponse.json({ processed: sent });
}
