import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { checkWeightedLimit } from "@/lib/rateLimit";
import {
  MAX_REPORT_NOTE_LENGTH,
  MIN_APPEAL_REASON_LENGTH,
  ReportActionError,
  fileReportAppeal,
} from "@/lib/reports";

const APPEALS_PER_HOUR = 5;

/**
 * POST /api/reports/:reportId/appeal — the reported member appeals a
 * resolution that acted on them (once, within 14 days): { reason }.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const limit = checkWeightedLimit(`appeal:${session.userId}`, 1, APPEALS_PER_HOUR, 60 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many appeals. Try again later." }, { status: 429 });
  }

  const { reportId } = await params;
  let body: { reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (reason.length < MIN_APPEAL_REASON_LENGTH || reason.length > MAX_REPORT_NOTE_LENGTH) {
    return NextResponse.json(
      { error: `Reason must be ${MIN_APPEAL_REASON_LENGTH}-${MAX_REPORT_NOTE_LENGTH} characters` },
      { status: 400 },
    );
  }

  try {
    const appeal = await fileReportAppeal({ userId: session.userId, reportId, reason });
    return NextResponse.json({ appeal }, { status: 201 });
  } catch (error) {
    if (error instanceof ReportActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[Campfire] Appeal error:", error);
    return NextResponse.json({ error: "Database error" }, { status: 503 });
  }
}
