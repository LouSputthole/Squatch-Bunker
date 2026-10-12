// Anonymous usage ping: the one contract shared by the collector route, the
// self-hosted server reporter, and the desktop launcher (desktop/main.cjs
// builds the same shape by hand; tests check it against parseTelemetryPing).
// Documented field-by-field in docs/TELEMETRY.md — change both together.

export const TELEMETRY_PROTOCOL_VERSION = 1;
export const TELEMETRY_PING_PATH = "/api/telemetry/ping";
export const TELEMETRY_MAX_BODY_BYTES = 2048;

export type TelemetryKind = "desktop" | "server";
export type DesktopMode = "cloud" | "host";

export interface TelemetryPing {
  v: 1;
  /** Random per install (desktop) or HMAC-derived per instance (server). Never user-identifying. */
  installId: string;
  kind: TelemetryKind;
  /** Desktop only: online client or "host on this PC". */
  mode: DesktopMode | null;
  version: string;
  /** Server only. */
  edition: "community" | "cloud" | null;
  /** e.g. "win32-x64". */
  platform: string | null;
  /** Server only: registered (non-guest) accounts. */
  users: number | null;
  /** Server only: registered (non-guest) accounts that posted in the last 7 days. */
  activeUsers: number | null;
}

/**
 * Broadcast notice ("a better version is out", "Campfire Pro is here").
 * The collector answers a ping with 200 {"notice": TelemetryNotice} when one is
 * set (CAMPFIRE_NOTICE on the hosted instance), otherwise 204 with no body.
 * Clients that ignore the body keep working.
 */
export interface TelemetryNotice {
  /** Stable id; clients remember dismissed ids. */
  id: string;
  text: string;
  /** https only. */
  url: string | null;
  urlLabel: string | null;
}

const NOTICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Strict parse of an untrusted notice (from env on the server, from the network on clients). */
export function parseTelemetryNotice(raw: unknown): TelemetryNotice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const notice = raw as Record<string, unknown>;
  if (typeof notice.id !== "string" || !NOTICE_ID.test(notice.id)) return null;
  if (typeof notice.text !== "string") return null;
  const text = notice.text.trim();
  if (!text || text.length > 280) return null;
  let url: string | null = null;
  if (notice.url != null) {
    if (typeof notice.url !== "string" || notice.url.length > 500) return null;
    try {
      const parsed = new URL(notice.url);
      if (parsed.protocol !== "https:") return null;
      url = parsed.toString();
    } catch {
      return null;
    }
  }
  let urlLabel: string | null = null;
  if (notice.urlLabel != null) {
    if (typeof notice.urlLabel !== "string" || !notice.urlLabel.trim() || notice.urlLabel.length > 40) return null;
    urlLabel = notice.urlLabel.trim();
  }
  return { id: notice.id, text, url, urlLabel: url ? urlLabel : null };
}

const INSTALL_ID = /^[A-Za-z0-9_-]{16,64}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
const PLATFORM = /^[0-9A-Za-z._-]{1,32}$/;
const MAX_COUNT = 10_000_000;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

function count(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_COUNT) return undefined;
  return value;
}

/** Strict parse of an untrusted ping body. Unknown fields are ignored; any invalid known field rejects the ping. */
export function parseTelemetryPing(raw: unknown): TelemetryPing | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const body = raw as Record<string, unknown>;
  if (body.v !== TELEMETRY_PROTOCOL_VERSION) return null;
  if (typeof body.installId !== "string" || !INSTALL_ID.test(body.installId)) return null;
  const kind = oneOf(body.kind, ["desktop", "server"] as const);
  if (!kind) return null;
  if (typeof body.version !== "string" || !VERSION.test(body.version)) return null;

  const mode = body.mode == null ? null : oneOf(body.mode, ["cloud", "host"] as const);
  if (body.mode != null && !mode) return null;
  const edition = body.edition == null ? null : oneOf(body.edition, ["community", "cloud"] as const);
  if (body.edition != null && !edition) return null;
  const platform = body.platform == null ? null : typeof body.platform === "string" && PLATFORM.test(body.platform) ? body.platform : undefined;
  if (platform === undefined) return null;
  const users = count(body.users);
  const activeUsers = count(body.activeUsers);
  if (users === undefined || activeUsers === undefined) return null;

  return {
    v: 1,
    installId: body.installId,
    kind,
    mode: kind === "desktop" ? mode : null,
    version: body.version,
    edition: kind === "server" ? edition : null,
    platform,
    users: kind === "server" ? users : null,
    activeUsers: kind === "server" ? activeUsers : null,
  };
}
