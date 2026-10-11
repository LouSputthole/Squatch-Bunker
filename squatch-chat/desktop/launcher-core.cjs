"use strict";

// Pure launcher decisions (no electron import) so tests can cover them.
// desktop/main.cjs wires them to the app; packaging/stage-desktop.mjs reuses
// parseCloudOrigin to validate the Campfire Online URL baked into a build.

const fs = require("node:fs");
const path = require("node:path");

// Mirrors TELEMETRY_PING_PATH in lib/telemetryProtocol.ts (tests assert they match).
const TELEMETRY_PING_PATH = "/api/telemetry/ping";
const TELEMETRY_OFF_VALUES = ["0", "false", "off", "no"];

/** https only, except http for a localhost dev server (same rule as lib/telemetry.ts). */
function parseAllowedUrl(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;
  try {
    const url = new URL(value);
    const localhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "https:" || (url.protocol === "http:" && localhost) ? url : null;
  } catch {
    return null;
  }
}

/** Campfire Online origin from a configured URL; null when blank or invalid. */
function parseCloudOrigin(raw) {
  return parseAllowedUrl(raw)?.origin ?? null;
}

/**
 * Whether a desktop database holds a camp or a registered account. Every
 * earlier build created one from the empty template on first launch, so the
 * file alone proves nothing. Any open or query error counts as data.
 */
function holdsLocalCommunities(Database, databasePath) {
  let database;
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    return Boolean(
      database.prepare('SELECT 1 FROM "Server" LIMIT 1').get() ||
        database.prepare('SELECT 1 FROM "User" WHERE "isGuest" = 0 LIMIT 1').get(),
    );
  } catch {
    return true;
  } finally {
    database?.close();
  }
}

/**
 * First-run mode: the online client, unless this PC already holds local
 * communities (a beta database or v0.0.3 state still waiting to be imported).
 * Without `Database` (better-sqlite3) any database file counts.
 * @param {{ cloudOrigin: string | null, userDataPath: string, portableDirectory?: string | null, Database?: any }} options
 * @returns {"cloud" | "host"}
 */
function defaultMode({ cloudOrigin, userDataPath, portableDirectory = null, Database = null }) {
  if (!cloudOrigin) return "host";
  // Same places importLegacyDesktopState looks (desktop/legacy-state.cjs).
  const legacyRoot = portableDirectory ? path.join(portableDirectory, "data") : userDataPath;
  const localDatabases = [
    path.join(userDataPath, "data", "campfire.db"),
    path.join(legacyRoot, "campfire.db"),
  ];
  return localDatabases.some(
    (databasePath) =>
      fs.existsSync(databasePath) && (!Database || holdsLocalCommunities(Database, databasePath)),
  )
    ? "host"
    : "cloud";
}

/**
 * @param {{ setting?: unknown, env: Record<string, string | undefined>, isPackaged: boolean }} options
 */
function telemetryEnabled({ setting, env, isPackaged }) {
  if (setting === false) return false;
  const flag = String(env.CAMPFIRE_TELEMETRY ?? "").trim().toLowerCase();
  if (TELEMETRY_OFF_VALUES.includes(flag)) return false;
  const doNotTrack = String(env.DO_NOT_TRACK ?? "").trim().toLowerCase();
  if (doNotTrack === "1" || doNotTrack === "true") return false;
  // Dev runs stay silent unless a collector is named explicitly.
  return isPackaged || Boolean(env.CAMPFIRE_TELEMETRY_URL);
}

/** Where pings go: CAMPFIRE_TELEMETRY_URL, else Campfire Online's collector, else nowhere.
 * @param {Record<string, string | undefined>} env
 * @param {string | null} cloudOrigin
 */
function telemetryTarget(env, cloudOrigin) {
  if (env.CAMPFIRE_TELEMETRY_URL?.trim()) return parseAllowedUrl(env.CAMPFIRE_TELEMETRY_URL)?.href ?? null;
  return cloudOrigin ? cloudOrigin + TELEMETRY_PING_PATH : null;
}

/**
 * The desktop ping, field for field per lib/telemetryProtocol.ts. Nothing user-identifying.
 * @param {{ installId: string, mode: "cloud" | "host", version: string, platform: string, arch: string }} options
 */
function buildDesktopPing({ installId, mode, version, platform, arch }) {
  return {
    v: 1,
    installId,
    kind: "desktop",
    mode,
    version,
    edition: null,
    platform: `${platform}-${arch}`,
    users: null,
    activeUsers: null,
  };
}

// ─── Broadcast notice (rides the ping response; contract: TelemetryNotice in lib/telemetryProtocol.ts) ───

const NOTICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// Ids of notices already shown; older ones fall off (a notice id is never reused).
const MAX_REMEMBERED_NOTICES = 50;
// A valid notice is well under 2 KB; anything bigger is not one.
const MAX_NOTICE_BODY_CHARS = 8192;

/** Hand-written twin of parseTelemetryNotice (tests assert both agree on the same inputs). */
function parseTelemetryNotice(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (typeof raw.id !== "string" || !NOTICE_ID.test(raw.id)) return null;
  if (typeof raw.text !== "string") return null;
  const text = raw.text.trim();
  if (!text || text.length > 280) return null;
  let url = null;
  if (raw.url != null) {
    if (typeof raw.url !== "string" || raw.url.length > 500) return null;
    try {
      const parsed = new URL(raw.url);
      if (parsed.protocol !== "https:") return null;
      url = parsed.toString();
    } catch {
      return null;
    }
  }
  let urlLabel = null;
  if (raw.urlLabel != null) {
    if (typeof raw.urlLabel !== "string" || !raw.urlLabel.trim() || raw.urlLabel.length > 40) return null;
    urlLabel = raw.urlLabel.trim();
  }
  return { id: raw.id, text, url, urlLabel: url ? urlLabel : null };
}

/** The collector answers 200 {"notice": ...} when a notice is set, else 204. Anything else: no notice. */
function noticeFromPingResponse(statusCode, body) {
  if (statusCode !== 200 || typeof body !== "string" || body.length > MAX_NOTICE_BODY_CHARS) return null;
  try {
    return parseTelemetryNotice(JSON.parse(body)?.notice);
  } catch {
    return null;
  }
}

/** Host mode only (Campfire Online shows its own web banner), and each notice id once. */
function shouldShowNotice({ notice, mode, dismissedIds }) {
  return Boolean(notice) && mode === "host" && !(Array.isArray(dismissedIds) && dismissedIds.includes(notice.id));
}

/** dismissedIds with id appended (most recent last), capped at MAX_REMEMBERED_NOTICES. */
function rememberNotice(dismissedIds, id) {
  const kept = Array.isArray(dismissedIds) ? dismissedIds.filter((value) => typeof value === "string" && value !== id) : [];
  return [...kept, id].slice(-MAX_REMEMBERED_NOTICES);
}

// ─── Updates ───

/**
 * "auto": electron-updater downloads in the background and installs (installed NSIS builds).
 * "manual": prompt to download from GitHub (portable builds have no installer to re-run).
 * "off": unpackaged dev runs.
 * @param {{ isPackaged: boolean, platform: string, portableDirectory?: string | null }} options
 * @returns {"auto" | "manual" | "off"}
 */
function updateMode({ isPackaged, platform, portableDirectory = null }) {
  if (!isPackaged) return "off";
  return platform === "win32" && !portableDirectory ? "auto" : "manual";
}

/** Semver prerelease ("0.1.0-beta.1"); build metadata alone ("1.0.0+5") is not one.
 * Only prerelease installs follow prerelease updates, so stable users never get a beta. */
function isPrerelease(version) {
  return /^v?\d+\.\d+\.\d+-/.test(String(version ?? "").trim());
}

/** Same version, ignoring a leading "v" (GitHub tags have one; electron-updater versions don't). */
function sameVersion(a, b) {
  const normalize = (value) => String(value ?? "").trim().replace(/^v/i, "");
  return normalize(a) !== "" && normalize(a) === normalize(b);
}

/**
 * Smoke-test override: CAMPFIRE_UPDATE_FEED_URL points electron-updater's generic provider at a
 * folder holding latest.yml + the setup exe + its blockmap (https, or http on localhost).
 * Null = the GitHub feed electron-builder bakes into resources/app-update.yml.
 * @param {Record<string, string | undefined>} env
 */
function updateFeedOverride(env) {
  const url = parseAllowedUrl(env.CAMPFIRE_UPDATE_FEED_URL);
  return url ? { provider: "generic", url: url.href } : null;
}

module.exports = {
  TELEMETRY_PING_PATH,
  buildDesktopPing,
  defaultMode,
  isPrerelease,
  noticeFromPingResponse,
  parseCloudOrigin,
  parseTelemetryNotice,
  rememberNotice,
  sameVersion,
  shouldShowNotice,
  telemetryEnabled,
  telemetryTarget,
  updateFeedOverride,
  updateMode,
};
