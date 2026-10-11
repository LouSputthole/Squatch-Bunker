import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { isInstanceAdmin } from "@/lib/instanceAdmin";
import {
  closeReport,
  deleteCamp,
  lookupModerationTarget,
  type ModerationResult,
  removeFile,
  removeMessage,
  suspendUser,
  unsuspendUser,
} from "@/lib/instanceModeration";
import { createOriginPolicy } from "@/lib/originPolicy";
import { checkRateLimit, checkWeightedLimit } from "@/lib/rateLimit";
import { parseReportResolution } from "@/lib/reports";

/**
 * Instance-operator moderation for /admin (lib/instanceModeration.ts). Anyone
 * but an instance admin gets the same 404 as the /admin page.
 */

const ACTIONS_PER_WINDOW = 60;
const ACTION_WINDOW_MS = 10 * 60 * 1000;
const MIN_REASON = 3;
const MAX_REASON = 500;
const MAX_ID = 200;

async function operatorId(): Promise<string | NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!isInstanceAdmin(session.userId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return session.userId;
}

function idFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() && value.length <= MAX_ID ? value.trim() : null;
}

/** GET ?q=<user id or username, message, DM, or camp id, or file address> */
export async function GET(request: Request) {
  const actor = await operatorId();
  if (actor instanceof NextResponse) return actor;
  if (!checkRateLimit(`instance-lookup:${actor}`).allowed) {
    return NextResponse.json({ error: "Too many lookups. Try again in a minute." }, { status: 429 });
  }
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query || query.length > MAX_ID) {
    return NextResponse.json({ error: "Enter an id, username, or file address" }, { status: 400 });
  }
  return NextResponse.json(await lookupModerationTarget(query));
}

export async function POST(request: Request) {
  const actor = await operatorId();
  if (actor instanceof NextResponse) return actor;

  // The session cookie is SameSite=Lax, but a cross-origin deploy relaxes it
  // to None. JSON-only plus an allowed Origin keeps forms on other sites out.
  const { isOriginAllowed } = createOriginPolicy({
    corsOrigins: process.env.CORS_ORIGINS,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    strictCors: process.env.STRICT_CORS,
  });
  if (
    !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")
    || !isOriginAllowed(request.headers.get("origin") ?? undefined)
  ) {
    return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  }

  const limit = checkWeightedLimit(`instance-moderation:${actor}`, 1, ACTIONS_PER_WINDOW, ACTION_WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many moderation actions. Try again in a few minutes." }, { status: 429 });
  }

  const parsed: unknown = await request.json().catch(() => null);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
    return NextResponse.json({ error: `Give a reason (${MIN_REASON}-${MAX_REASON} characters)` }, { status: 400 });
  }
  const evidence = body.evidence === true;

  let result: ModerationResult | null = null;
  try {
    switch (body.action) {
      case "suspend_user":
      case "unsuspend_user": {
        const userId = idFrom(body.userId);
        if (!userId) break;
        result = body.action === "suspend_user"
          ? await suspendUser(actor, userId, reason, body.blockIdentity === true)
          : await unsuspendUser(actor, userId, reason);
        break;
      }
      case "remove_message": {
        const messageId = idFrom(body.messageId);
        if (messageId) result = await removeMessage(actor, messageId, reason, evidence);
        break;
      }
      case "remove_file": {
        const address = idFrom(body.address);
        if (address) result = await removeFile(actor, address, reason, evidence);
        break;
      }
      case "delete_camp": {
        const serverId = idFrom(body.serverId);
        if (serverId) result = await deleteCamp(actor, serverId, reason);
        break;
      }
      case "close_report": {
        const reportId = idFrom(body.reportId);
        const resolution = parseReportResolution(body.resolution);
        if (reportId && resolution) result = await closeReport(actor, reportId, resolution, reason);
        break;
      }
    }
  } catch (error) {
    console.error("[Campfire] Instance moderation action failed:", body.action, error);
    return NextResponse.json({ error: "The action failed. Look the target up again before retrying." }, { status: 500 });
  }

  if (!result) return NextResponse.json({ error: "Unknown action or missing target" }, { status: 400 });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
