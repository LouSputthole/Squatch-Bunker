import { NextResponse } from "next/server";
import { clientIp, clientNetwork } from "@/lib/clientIp";
import { currentNotice } from "@/lib/notice";
import { checkWeightedLimit } from "@/lib/rateLimit";
import { isTelemetryCollector, recordTelemetryPing } from "@/lib/telemetryCollector";
import { parseTelemetryPing, TELEMETRY_MAX_BODY_BYTES } from "@/lib/telemetryProtocol";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "cache-control": "no-store" };
const PINGS_PER_HOUR = 20;
// ponytail: one process-wide budget (one machine). It bounds table growth when
// fake installIds arrive from many networks; a real install turned away is
// recorded by its next daily ping. Raise it if a launch day needs more.
const NEW_INSTALLS_PER_HOUR = 1000;
const HOUR_MS = 60 * 60 * 1000;

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE_HEADERS });
}

/** The body as text, or null past the cap; Content-Length may be missing or lie. */
async function boundedText(request: Request): Promise<string | null> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > TELEMETRY_MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > TELEMETRY_MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Anonymous install ping (lib/telemetryProtocol.ts). No auth by design: the
 * body carries nothing user-identifying, and the caller's IP is only an
 * in-memory limiter key — it is never stored. Answers 204, or 200 {notice}
 * while CAMPFIRE_NOTICE is set (lib/notice.ts).
 */
export async function POST(request: Request) {
  if (!isTelemetryCollector()) return fail(404, "Not found");
  // Real senders always say JSON. Browsers must preflight a cross-origin JSON
  // POST (and get no CORS grant), so other sites can't make visitors ping.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return fail(415, "Ping must be JSON");
  }

  const limit = checkWeightedLimit(
    `telemetry:${clientNetwork(clientIp(request))}`,
    1,
    PINGS_PER_HOUR,
    HOUR_MS,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many pings" },
      {
        status: 429,
        headers: {
          ...NO_STORE_HEADERS,
          "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)),
        },
      },
    );
  }

  try {
    const text = await boundedText(request);
    if (text === null) return fail(413, "Ping too large");
    let raw: unknown = null;
    try {
      raw = JSON.parse(text);
    } catch {
      // Falls through to the 400 below.
    }
    const ping = parseTelemetryPing(raw);
    if (!ping) return fail(400, "Invalid ping");

    const recorded = await recordTelemetryPing(ping, new Date(), () =>
      checkWeightedLimit("telemetry:new-installs", 1, NEW_INSTALLS_PER_HOUR, HOUR_MS).allowed,
    );
    if (!recorded) return fail(503, "Collector busy");
    const notice = currentNotice();
    if (notice) return NextResponse.json({ notice }, { headers: NO_STORE_HEADERS });
    return new NextResponse(null, { status: 204, headers: NO_STORE_HEADERS });
  } catch {
    return fail(500, "Ping not recorded");
  }
}
