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

module.exports = {
  TELEMETRY_PING_PATH,
  buildDesktopPing,
  defaultMode,
  parseCloudOrigin,
  telemetryEnabled,
  telemetryTarget,
};
