import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  canReviewReports,
  parseReportResolution,
  viewerCanReviewReport,
} from "@/lib/reports";

/**
 * PATCH /api/servers/:serverId/reports/:reportId — close an open report as
 * "resolved" or "dismissed". A report this moderator can't review here (no
 * message evidence in a channel they can view, or one that targets them) is a
 * 404, so the route can't probe or close other communities' reports.
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

  let body: { status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const status = parseReportResolution(body?.status);
  if (!status) {
    return NextResponse.json({ error: "status must be \"resolved\" or \"dismissed\"" }, { status: 400 });
  }

  const report = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      id: true,
      targetUserId: true,
      messageId: true,
      reporter: { select: { username: true } },
    },
  });
  if (!report || !(await viewerCanReviewReport(serverId, session.userId, report))) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  // Compare-and-set on "open": two moderators acting at once produce one
  // outcome and one audit row.
  const closed = await prisma.$transaction(async (tx) => {
    const updated = await tx.report.updateMany({
      where: { id: report.id, status: "open" },
      data: { status },
    });
    if (updated.count === 0) return false;
    await tx.auditLog.create({
      data: {
        serverId,
        actorId: session.userId,
        // No reporter or target here: anyone with VIEW_AUDIT_LOG (incl. a reported
        // moderator) can read the log, and the desk hides reports about the viewer.
        targetId: null,
        action: status === "resolved" ? "report_resolve" : "report_dismiss",
        detail: `Report ${report.id} marked ${status}`,
      },
    });
    return true;
  });
  if (!closed) {
    return NextResponse.json({ error: "Report was already handled" }, { status: 409 });
  }

  return NextResponse.json({ report: { id: report.id, status } });
}
