import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canReviewReports, listReportReviewers, listServerReports } from "@/lib/reports";

/**
 * GET /api/servers/:serverId/reports — the Ranger Desk queue: reports in this
 * community that need attention; `?include=recent` adds ones handled in the
 * last 30 days. Also returns the members a report can be assigned to.
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
    const [result, reviewers] = await Promise.all([
      listServerReports(serverId, session.userId, { includeRecent }),
      listReportReviewers(serverId),
    ]);
    return NextResponse.json({ ...result, reviewers, viewerId: session.userId });
  } catch (err) {
    console.error("[Campfire] Server reports error:", err);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
