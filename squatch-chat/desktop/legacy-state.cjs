"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { upgradeDesktopDatabase } = require("./database.cjs");

const LEGACY_MIGRATION = "0001_init";

function directoryHasEntries(directory) {
  return fs.existsSync(directory) && fs.readdirSync(directory).length > 0;
}

async function copyLegacyDatabase(databasePath, destinationPath, Database) {
  const database = new Database(databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    database.pragma("foreign_keys = ON");
    const integrity = database.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") {
      throw new Error("Legacy desktop SQLite integrity_check failed: " + integrity);
    }
    const foreignKeys = database.pragma("foreign_key_check");
    if (foreignKeys.length > 0) {
      throw new Error(
        "Legacy desktop SQLite foreign_key_check found " +
          foreignKeys.length +
          " violation(s)",
      );
    }
    if (database.pragma("user_version", { simple: true }) !== 0) {
      throw new Error("Legacy desktop database does not have the v0.0.3 schema stamp");
    }
    const migrationTable = database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_campfire_migrations'",
      )
      .get();
    if (!migrationTable) {
      throw new Error("Legacy desktop database is missing _campfire_migrations");
    }
    const migration = database
      .prepare('SELECT 1 FROM "_campfire_migrations" WHERE "name" = ?')
      .get(LEGACY_MIGRATION);
    if (!migration) {
      throw new Error("Legacy desktop database is missing migration " + LEGACY_MIGRATION);
    }
    await database.backup(destinationPath);
  } finally {
    database.close();
  }
}

function copyLegacyMedia(legacyRoot, stagingMediaRoot) {
  let copied = false;
  for (const directory of ["uploads", "avatars"]) {
    const source = path.join(legacyRoot, directory);
    const destination = path.join(stagingMediaRoot, directory);
    if (fs.existsSync(source)) {
      fs.cpSync(source, destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      copied = true;
    } else {
      fs.mkdirSync(destination, { recursive: true });
    }
  }
  fs.mkdirSync(path.join(stagingMediaRoot, "private-uploads"), {
    recursive: true,
  });
  return copied;
}

function stageLegacyConfig(legacyRoot, stagingRoot, log) {
  const secretPath = path.join(legacyRoot, "secret");
  if (!fs.existsSync(secretPath)) return false;
  const jwtSecret = fs.readFileSync(secretPath, "utf8").trim();
  if (jwtSecret.length < 64) {
    log(
      "[Campfire] Legacy desktop JWT secret is invalid; the database can be imported but sessions will reset.",
    );
    return false;
  }
  fs.writeFileSync(
    path.join(stagingRoot, "desktop-config.json"),
    JSON.stringify({ jwtSecret }, null, 2) + "\n",
    { mode: 0o600 },
  );
  return true;
}

/**
 * @param {{
 *   userDataPath: string,
 *   portableDirectory?: string | null,
 *   Database: any,
 *   log?: (message: string) => void
 * }} options
 */
async function importLegacyDesktopState({
  userDataPath,
  portableDirectory = null,
  Database,
  log = console.log,
}) {
  if (!userDataPath) throw new Error("Desktop user data path is required");
  if (!Database) throw new Error("Desktop database constructor is required");

  fs.mkdirSync(userDataPath, { recursive: true });
  const canonicalDatabase = path.join(userDataPath, "data", "campfire.db");
  if (fs.existsSync(canonicalDatabase)) {
    const result = { status: "existing-beta", databasePath: canonicalDatabase };
    log("[Campfire] Existing beta desktop state found; legacy import was not needed.");
    return result;
  }

  const canonicalData = path.join(userDataPath, "data");
  const canonicalMedia = path.join(userDataPath, "media");
  const canonicalConfig = path.join(userDataPath, "desktop-config.json");
  const conflict =
    directoryHasEntries(canonicalData) ||
    directoryHasEntries(canonicalMedia) ||
    fs.existsSync(canonicalConfig);
  if (conflict) {
    const result = { status: "conflict", userDataPath };
    log(
      "[Campfire] Legacy desktop state was not imported because beta state already exists.",
    );
    return result;
  }

  const legacyRoot = portableDirectory
    ? path.join(portableDirectory, "data")
    : userDataPath;
  const legacyDatabase = path.join(legacyRoot, "campfire.db");
  if (!fs.existsSync(legacyDatabase)) {
    const result = { status: "not-found", legacyRoot };
    log("[Campfire] No v0.0.3 desktop state was found; using fresh beta state.");
    return result;
  }

  const stagingRoot = fs.mkdtempSync(
    path.join(userDataPath, ".legacy-import-"),
  );
  const stagedData = path.join(stagingRoot, "data");
  const stagedMedia = path.join(stagingRoot, "media");
  const stagedDatabase = path.join(stagedData, "campfire.db");
  const committed = [];
  try {
    fs.mkdirSync(stagedData, { recursive: true });
    fs.mkdirSync(stagedMedia, { recursive: true });
    await copyLegacyDatabase(
      legacyDatabase,
      stagedDatabase,
      Database,
    );
    upgradeDesktopDatabase({
      databasePath: stagedDatabase,
      Database,
      log,
    });
    const copiedMedia = copyLegacyMedia(legacyRoot, stagedMedia);
    const preservedJwtSecret = stageLegacyConfig(legacyRoot, stagingRoot, log);

    const moves = [
      [stagedMedia, canonicalMedia],
      ...(preservedJwtSecret
        ? [[path.join(stagingRoot, "desktop-config.json"), canonicalConfig]]
        : []),
      [stagedData, canonicalData],
    ];
    for (const [source, destination] of moves) {
      if (fs.existsSync(destination)) {
        throw new Error("Beta state appeared during legacy import: " + destination);
      }
      fs.renameSync(source, destination);
      committed.push(destination);
    }

    const result = {
      status: "imported",
      legacyRoot,
      databasePath: canonicalDatabase,
      copiedMedia,
      preservedJwtSecret,
    };
    log(
      "[Campfire] Imported v0.0.3 desktop state from " +
        legacyRoot +
        " without modifying the legacy copy.",
    );
    return result;
  } catch (error) {
    for (const destination of committed.reverse()) {
      fs.rmSync(destination, { recursive: true, force: true });
    }
    log(
      "[Campfire] Legacy desktop import failed safely; the original state was left unchanged.",
    );
    throw error;
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

module.exports = {
  importLegacyDesktopState,
};
