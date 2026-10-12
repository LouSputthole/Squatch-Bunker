import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  ReportActionError,
  canReviewReports,
  decideReportAppeal,
  parseAppealDecision,
  parseNote,
} from "@/lib/reports";

/**
 * PATCH /api/servers/:serverId/reports/:reportId/appeal — decide the member's
 * appeal: { decision: "accepted" | "rejected", note? }. The ranger who resolved
 * the report can't decide it (the owner can); accepting a ban lifts it.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ serverId: string; reportId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId, reportId } = await params;
  if (!(await canReviewReports(serverId, session.userId))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  let body: { decision?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const decision = parseAppealDecision(body?.decision);
  if (!decision) {
    return NextResponse.json({ error: "decision must be \"accepted\" or \"rejected\"" }, { status: 400 });
  }
  const note = parseNote(body?.note);
  if (note === undefined) {
    return NextResponse.json({ error: "note must be a string of at most 1000 characters" }, { status: 400 });
  }

  try {
    const appeal = await decideReportAppeal({ serverId, actorId: session.userId, reportId, decision, note });
    return NextResponse.json({ appeal });
  } catch (error) {
    if (error instanceof ReportActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Campfire] Appeal decision error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
