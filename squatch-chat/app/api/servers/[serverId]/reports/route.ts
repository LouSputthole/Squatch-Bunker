import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canReviewReports, listServerReports } from "@/lib/reports";

/**
 * GET /api/servers/:serverId/reports — the Ranger Desk queue. Open reports in
 * this server's context; `?include=recent` adds ones handled in the last 30 days.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId } = await params;
  if (!(await canReviewReports(serverId, session.userId))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const includeRecent = new URL(req.url).searchParams.get("include") === "recent";
  try {
    const result = await listServerReports(serverId, session.userId, { includeRecent });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[Campfire] Server reports error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
