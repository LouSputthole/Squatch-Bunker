import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listModerationNotices } from "@/lib/reports";

/**
 * GET /api/reports/notices — moderation actions taken on the signed-in member
 * (newest first) with their appeal state. Never reveals who reported them.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    return NextResponse.json({ notices: await listModerationNotices(session.userId) });
  } catch (error) {
    console.error("[Campfire] Moderation notices error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
