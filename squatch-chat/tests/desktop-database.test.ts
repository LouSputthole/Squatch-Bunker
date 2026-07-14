import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_SCHEMA_VERSION,
  upgradeDesktopDatabase,
} from "@/desktop/database.cjs";

const Database = createRequire(import.meta.url)("better-sqlite3");
const temporaryDirectories: string[] = [];

function createLegacyDatabase({ duplicateStripe = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "campfire-desktop-db-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "campfire.db");
  const database = new Database(databasePath);
  database.exec(`
    CREATE TABLE "User" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "stripeCustomerId" TEXT,
      "stripeSubscriptionId" TEXT
    );
    CREATE TABLE "Server" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "inviteCode" TEXT NOT NULL UNIQUE
    );
    CREATE TABLE "Channel" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "Message" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "DirectMessage" ("id" TEXT NOT NULL PRIMARY KEY);
    CREATE TABLE "JournalEntry" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "serverId" TEXT NOT NULL,
      "authorId" TEXT NOT NULL,
      "sourceMessageId" TEXT,
      "content" TEXT NOT NULL,
      "attachmentUrl" TEXT,
      "attachmentName" TEXT,
      "note" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "Friendship" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "requesterId" TEXT NOT NULL,
      "addresseeId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "updatedAt" DATETIME NOT NULL
    );
  `);
  const insertUser = database.prepare(
    'INSERT INTO "User" ("id", "stripeCustomerId") VALUES (?, ?)',
  );
  insertUser.run("user-1", duplicateStripe ? "cus_duplicate" : "cus_one");
  insertUser.run("user-2", duplicateStripe ? "cus_duplicate" : "cus_two");
  database
    .prepare(
      `INSERT INTO "Friendship"
       ("id", "requesterId", "addresseeId", "status", "updatedAt")
       VALUES (?, ?, ?, 'blocked', CURRENT_TIMESTAMP)`,
    )
    .run("friendship-1", "user-1", "user-2");
  database.pragma("user_version = 3");
  database.close();
  return { databasePath, directory };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("desktop database upgrades", () => {
  it("backs up and upgrades a legacy database exactly once", () => {
    const { databasePath, directory } = createLegacyDatabase();
    const first = upgradeDesktopDatabase({
      databasePath,
      Database,
      log: () => undefined,
    });
    expect(first.upgraded).toBe(true);
    expect(first.backupPath && existsSync(first.backupPath)).toBe(true);

    const database = new Database(databasePath, { readonly: true });
    expect(database.pragma("user_version", { simple: true })).toBe(
      DESKTOP_SCHEMA_VERSION,
    );
    expect(
      database
        .prepare('SELECT "blockerId", "blockedId" FROM "UserBlock"')
        .get(),
    ).toEqual({ blockerId: "user-2", blockedId: "user-1" });
    expect(
      database
        .prepare(`SELECT COUNT(*) AS count FROM "Friendship" WHERE "status" = 'blocked'`)
        .get(),
    ).toEqual({ count: 0 });
    for (const table of [
      "PrivateUpload",
      "JournalEntry",
      "Poll",
      "PollOption",
      "PollVote",
      "Gathering",
      "GatheringRsvp",
    ]) {
      expect(
        database
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table),
      ).toBeTruthy();
    }
    for (const [table, column] of [
      ["Message", "privateUploadId"],
      ["DirectMessage", "privateUploadId"],
      ["JournalEntry", "privateUploadId"],
    ]) {
      expect(
        database
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .some((entry: { name: string }) => entry.name === column),
      ).toBe(true);
    }
    for (const index of [
      "PrivateUpload_storageKey_key",
      "PrivateUpload_claimKind_claimId_key",
      "PrivateUpload_ownerId_state_createdAt_idx",
      "Message_privateUploadId_key",
      "DirectMessage_privateUploadId_key",
      "JournalEntry_privateUploadId_idx",
    ]) {
      expect(
        database
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(index),
      ).toBeTruthy();
    }
    expect(
      database
        .prepare('PRAGMA foreign_key_list("PrivateUpload")')
        .all()
        .find((entry: { from: string }) => entry.from === "ownerId"),
    ).toMatchObject({ table: "User", to: "id", on_delete: "RESTRICT" });
    database.close();

    const backupsBefore = readdirSync(join(directory, "backups")).length;
    const second = upgradeDesktopDatabase({
      databasePath,
      Database,
      log: () => undefined,
    });
    expect(second).toEqual({ upgraded: false, backupPath: null });
    expect(readdirSync(join(directory, "backups"))).toHaveLength(backupsBefore);
  });

  it("refuses duplicate Stripe identifiers before changing the schema", () => {
    const { databasePath, directory } = createLegacyDatabase({
      duplicateStripe: true,
    });
    expect(() =>
      upgradeDesktopDatabase({
        databasePath,
        Database,
        log: () => undefined,
      }),
    ).toThrow(/stripeCustomerId has duplicates/);
    expect(existsSync(join(directory, "backups"))).toBe(false);

    const database = new Database(databasePath, { readonly: true });
    expect(database.pragma("user_version", { simple: true })).toBe(3);
    expect(
      database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'UserBlock'")
        .get(),
    ).toBeUndefined();
    database.close();
  });

  it("rejects a current-version stamp on an incomplete schema", () => {
    const { databasePath } = createLegacyDatabase();
    const database = new Database(databasePath);
    database.pragma(`user_version = ${DESKTOP_SCHEMA_VERSION}`);
    database.close();

    expect(() =>
      upgradeDesktopDatabase({
        databasePath,
        Database,
        log: () => undefined,
      }),
    ).toThrow(/missing User.billingCheckoutPendingAt/);
  });
});

describe("desktop private attachment storage", () => {
  it("creates a private media directory separate from legacy public uploads", () => {
    const mainSource = readFileSync(
      new URL("../desktop/main.cjs", import.meta.url),
      "utf8",
    );

    expect(mainSource).toContain('path.join(mediaRoot, "private-uploads")');
    expect(mainSource).toContain('path.join(mediaRoot, "uploads")');
  });
});
