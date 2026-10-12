import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  ReportActionError,
  assignServerReport,
  canReviewReports,
  closeServerReport,
  escalateServerReport,
  getServerReportCase,
  parseNote,
  parseReportAction,
  parseReportResolution,
} from "@/lib/reports";

type Params = { params: Promise<{ serverId: string; reportId: string }> };

/** GET — one case with its history, for a reviewer of this community. */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId, reportId } = await params;
  if (!(await canReviewReports(serverId, session.userId))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }
  const detail = await getServerReportCase(serverId, session.userId, reportId);
  if (!detail) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json(detail);
}

/**
 * PATCH — exactly one of:
 *   { assigneeId: string | null }                      assign / unassign
 *   { status: "escalated", note? }                     hand to the instance operator
 *   { status: "resolved", action, note? }              close, acting on the member
 *   { status: "dismissed", note? }                     close without action
 * A report this moderator can't review here (filed elsewhere, hidden channel,
 * or one that targets them) is a 404, so the route can't probe or close other
 * communities' reports.
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { serverId, reportId } = await params;
  if (!(await canReviewReports(serverId, session.userId))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  let body: { status?: unknown; action?: unknown; note?: unknown; assigneeId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const note = parseNote(body?.note);
  if (note === undefined) {
    return NextResponse.json({ error: "note must be a string of at most 1000 characters" }, { status: 400 });
  }

  try {
    if ("assigneeId" in body) {
      if (body.status !== undefined) {
        return NextResponse.json({ error: "Send either assigneeId or status" }, { status: 400 });
      }
      if (body.assigneeId !== null && typeof body.assigneeId !== "string") {
        return NextResponse.json({ error: "assigneeId must be a user id or null" }, { status: 400 });
      }
      const { assignee } = await assignServerReport({
        serverId,
        actorId: session.userId,
        reportId,
        assigneeId: body.assigneeId,
      });
      return NextResponse.json({ report: { id: reportId, assignee } });
    }

    if (body.status === "escalated") {
      await escalateServerReport({ serverId, actorId: session.userId, reportId, note });
      return NextResponse.json({ report: { id: reportId, status: "escalated" } });
    }

    const status = parseReportResolution(body?.status);
    if (!status) {
      return NextResponse.json(
        { error: "status must be \"resolved\", \"dismissed\", or \"escalated\"" },
        { status: 400 },
      );
    }
    const action = body.action === undefined ? null : parseReportAction(body.action);
    if (status === "resolved" && action === null) {
      return NextResponse.json(
        { error: "action must be one of none, message_deleted, warned, kicked, banned" },
        { status: 400 },
      );
    }
    const result = await closeServerReport({
      serverId,
      actorId: session.userId,
      reportId,
      status,
      action,
      note,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ReportActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Campfire] Report update error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
