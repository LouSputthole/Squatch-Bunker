// Anonymous usage ping from a running Campfire server (kind "server"): one
// small POST a day so we know how many Campfires are out there. Contract in
// lib/telemetryProtocol.ts, user-facing description in docs/TELEMETRY.md.
// Never sends IPs, names, emails, hostnames, server/channel names, or content.

import { createHmac } from "node:crypto";
import packageJson from "@/package.json";
import { prisma } from "@/lib/db";
import { getEdition } from "@/lib/edition";
import {
  TELEMETRY_PING_PATH,
  TELEMETRY_PROTOCOL_VERSION,
  type TelemetryPing,
} from "@/lib/telemetryProtocol";

type Environment = Record<string, string | undefined>;

/**
 * The official Campfire Online origin, e.g. "https://campfire.example".
 * Fill it in once the domain is decided; CAMPFIRE_CLOUD_URL overrides it.
 * Blank means no ping is sent anywhere.
 */
export const OFFICIAL_CLOUD_URL = "";

const FIRST_PING_DELAY_MS = 60_000;
const PING_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const OPT_OUT_VALUES = new Set(["0", "false", "off", "no"]);

function flagSet(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/**
 * Where pings go: CAMPFIRE_TELEMETRY_URL, else the cloud origin's ping path,
 * else nowhere. Only HTTPS, or plain HTTP to localhost for testing.
 */
export function telemetryTarget(env: Environment = process.env): string | null {
  const explicit = env.CAMPFIRE_TELEMETRY_URL?.trim();
  const origin = env.CAMPFIRE_CLOUD_URL?.trim() || OFFICIAL_CLOUD_URL;
  if (!explicit && !origin) return null;
  try {
    const url = explicit ? new URL(explicit) : new URL(TELEMETRY_PING_PATH, origin);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "https:" || (url.protocol === "http:" && local) ? url.href : null;
  } catch {
    return null;
  }
}

/** The operator's "no phoning home" switches: CAMPFIRE_TELEMETRY=off (or 0/false/no), DO_NOT_TRACK=1. */
export function telemetryOptedOut(env: Environment = process.env): boolean {
  return OPT_OUT_VALUES.has(env.CAMPFIRE_TELEMETRY?.trim().toLowerCase() ?? "") || flagSet(env.DO_NOT_TRACK);
}

export function telemetryEnabled(env: Environment = process.env): boolean {
  if (telemetryOptedOut(env)) return false;
  // The hosted service counts its own web users directly.
  if (flagSet(env.CAMPFIRE_TELEMETRY_COLLECTOR)) return false;
  // Dev servers stay silent unless someone is explicitly testing a collector.
  if (env.NODE_ENV !== "production" && !env.CAMPFIRE_TELEMETRY_URL?.trim()) return false;
  return telemetryTarget(env) !== null;
}

/**
 * Stable per instance with zero storage: an HMAC of a fixed label under
 * JWT_SECRET (required at startup by lib/config) reveals nothing about the secret.
 */
export function serverInstallId(env: Environment = process.env): string {
  return createHmac("sha256", env.JWT_SECRET ?? "")
    .update("campfire-telemetry-install-id-v1")
    .digest("base64url")
    .slice(0, 32);
}

export async function buildServerPing(env: Environment = process.env): Promise<TelemetryPing> {
  const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
  const [users, activeUsers] = await Promise.all([
    prisma.user.count({ where: { isGuest: false } }),
    prisma.user.count({ where: { isGuest: false, messages: { some: { createdAt: { gte: since } } } } }),
  ]);
  return {
    v: TELEMETRY_PROTOCOL_VERSION,
    installId: serverInstallId(env),
    kind: "server",
    mode: null,
    version: packageJson.version,
    edition: getEdition(env),
    platform: `${process.platform}-${process.arch}`,
    users,
    activeUsers,
  };
}

/** One ping. Every failure is swallowed with a single short line; no retries. */
export async function reportTelemetry(target: string, env: Environment = process.env): Promise<void> {
  try {
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(await buildServerPing(env)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).split("\n")[0];
    console.warn(`[Campfire] Usage ping failed: ${reason}`);
  }
}

/** First ping ~60s after boot, then daily. Returns a stop function. */
export function startTelemetryReporter(env: Environment = process.env): () => void {
  const target = telemetryTarget(env);
  if (!target || !telemetryEnabled(env)) return () => {};
  console.log(
    "[Campfire] Campfire sends an anonymous usage ping (version + install counts, no personal data). "
    + "Disable with CAMPFIRE_TELEMETRY=off - see docs/TELEMETRY.md",
  );
  const ping = () => void reportTelemetry(target, env);
  const first = setTimeout(ping, FIRST_PING_DELAY_MS);
  const daily = setInterval(ping, PING_INTERVAL_MS);
  first.unref();
  daily.unref();
  return () => {
    clearTimeout(first);
    clearInterval(daily);
  };
}
