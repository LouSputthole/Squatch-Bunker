import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isInstanceAdmin } from "@/lib/instanceAdmin";
import {
  ReportActionError,
  closeOperatorReport,
  parseNote,
  parseReportAction,
  parseReportResolution,
} from "@/lib/reports";

/**
 * PATCH /api/admin/reports/:reportId — the instance operator closes an
 * escalated or community-less report: { status: "resolved" | "dismissed",
 * action?: "none" | "message_deleted", note? }. Deny-by-default: only user
 * IDs in INSTANCE_ADMIN_USER_IDS get past the 404.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const session = await getSession();
  if (!session || !isInstanceAdmin(session.userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { reportId } = await params;
  let body: { status?: unknown; action?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const status = parseReportResolution(body?.status);
  if (!status) {
    return NextResponse.json({ error: "status must be \"resolved\" or \"dismissed\"" }, { status: 400 });
  }
  const action = body.action === undefined ? null : parseReportAction(body.action);
  if (status === "resolved" && action === null) {
    return NextResponse.json({ error: "action must be \"none\" or \"message_deleted\"" }, { status: 400 });
  }
  const note = parseNote(body?.note);
  if (note === undefined) {
    return NextResponse.json({ error: "note must be a string of at most 1000 characters" }, { status: 400 });
  }

  try {
    const result = await closeOperatorReport({ actorId: session.userId, reportId, status, action, note });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReportActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Campfire] Operator report error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
