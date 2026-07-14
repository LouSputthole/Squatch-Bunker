#!/usr/bin/env node

import {
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const databaseUrl = process.env.DATABASE_URL || "file:./data/campfire.db";

if (
  process.env.CI !== "true" ||
  process.env.CAMPFIRE_ALLOW_DESTRUCTIVE_FIXTURE !== "1"
) {
  throw new Error(
    "[Campfire] Refusing to replace a SQLite database outside the explicit CI fixture gate.",
  );
}

if (!databaseUrl.startsWith("file:")) {
  throw new Error(
    "[Campfire] The v0.0.3 SQLite fixture requires a file: DATABASE_URL.",
  );
}

const urlPath = decodeURIComponent(
  databaseUrl.slice("file:".length).split(/[?#]/, 1)[0],
);
if (!urlPath || urlPath === ":memory:") {
  throw new Error("[Campfire] The v0.0.3 fixture requires an on-disk database.");
}
const databasePath = isAbsolute(urlPath) ? urlPath : resolve(root, urlPath);
const migrationPath = resolve(
  root,
  "..",
  "desktop",
  "db-migrations",
  "0001_init",
  "migration.sql",
);

mkdirSync(dirname(databasePath), { recursive: true });
for (const suffix of ["", "-journal", "-wal", "-shm"]) {
  rmSync(databasePath + suffix, { force: true });
}

const database = new Database(databasePath);
try {
  database.pragma("foreign_keys = ON");
  database.exec(readFileSync(migrationPath, "utf8"));
  database.exec(`
    INSERT INTO "User" (
      "id", "email", "username", "passwordHash",
      "stripeCustomerId", "stripeSubscriptionId", "updatedAt"
    )
    VALUES
      (
        'legacy-owner', 'owner@legacy.test', 'legacy_owner', 'hash',
        'cus_legacy_owner', 'sub_legacy_owner', CURRENT_TIMESTAMP
      ),
      (
        'legacy-member', 'member@legacy.test', 'legacy_member', 'hash',
        'cus_legacy_member', 'sub_legacy_member', CURRENT_TIMESTAMP
      );

    INSERT INTO "Server" ("id", "name", "ownerId", "inviteCode")
    VALUES ('legacy-server', 'Legacy Camp', 'legacy-owner', 'legacy-invite');

    INSERT INTO "Channel" ("id", "serverId", "name")
    VALUES ('legacy-channel', 'legacy-server', 'general');

    INSERT INTO "Message" (
      "id", "channelId", "authorId", "content", "updatedAt"
    )
    VALUES (
      'legacy-message', 'legacy-channel', 'legacy-owner',
      'still here', CURRENT_TIMESTAMP
    );

    INSERT INTO "Friendship" (
      "id", "requesterId", "addresseeId", "status", "createdAt", "updatedAt"
    )
    VALUES (
      'legacy-block', 'legacy-member', 'legacy-owner', 'blocked',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    );

    PRAGMA user_version = 0;
  `);
  database.pragma("journal_mode = WAL");
  if (database.pragma("integrity_check", { simple: true }) !== "ok") {
    throw new Error("[Campfire] v0.0.3 SQLite fixture failed integrity_check.");
  }
} finally {
  database.close();
}

console.log(
  `[Campfire] Created a real v0.0.3 SQLite fixture at ${databasePath}.`,
);
