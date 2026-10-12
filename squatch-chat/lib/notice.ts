import { parseTelemetryNotice, type TelemetryNotice } from "@/lib/telemetryProtocol";

// The broadcast notice for this instance ("a better version is out", "Campfire
// Pro is here"): CAMPFIRE_NOTICE, JSON matching TelemetryNotice. Served to this
// instance's own web users (/api/notice) and, on the collector, to every ping.
// ponytail: env-driven, so changing it is `fly secrets set` + restart; add a
// DB row and an /admin editor once notices change weekly.

type Environment = Record<string, string | undefined>;

let cached: { raw: string; notice: TelemetryNotice | null } | null = null;

/** The parsed notice, or null when unset or invalid (warned once per value, not per request). */
export function currentNotice(env: Environment = process.env): TelemetryNotice | null {
  const raw = env.CAMPFIRE_NOTICE?.trim() ?? "";
  if (cached?.raw === raw) return cached.notice;
  let notice: TelemetryNotice | null = null;
  if (raw) {
    try {
      notice = parseTelemetryNotice(JSON.parse(raw));
    } catch {
      // Not JSON; warned below.
    }
    if (!notice) {
      console.warn("[Campfire] CAMPFIRE_NOTICE is not a valid notice (see docs/TELEMETRY.md); showing none.");
    }
  }
  cached = { raw, notice };
  return notice;
}
