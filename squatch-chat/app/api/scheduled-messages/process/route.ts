import { NextResponse } from "next/server";
import { deliverDueMessages } from "@/lib/scheduledDelivery";

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.SCHEDULER_SECRET;

  // External schedulers are opt-in and must always authenticate. The unified
  // Campfire host has its own in-process worker and does not call this route.
  if (!secret) {
    return NextResponse.json(
      { error: "External scheduler is not configured" },
      { status: 503 },
    );
  }
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await deliverDueMessages();
  return NextResponse.json({
    processed: result.delivered.length,
    dropped: result.dropped.length,
    failed: result.failed.length,
  });
}
