import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_SCHEMA_VERSION,
  upgradeDesktopDatabase,
} from "@/desktop/database.cjs";
import { importLegacyDesktopState } from "@/desktop/legacy-state.cjs";

const Database = createRequire(import.meta.url)("better-sqlite3");
const temporaryDirectories: string[] = [];

function createV003DesktopState(root: string) {
  const databasePath = join(root, "campfire.db");
  const database = new Database(databasePath);
  database.exec(
    readFileSync(
      resolve(
        process.cwd(),
        "..",
        "desktop",
        "db-migrations",
        "0001_init",
        "migration.sql",
      ),
      "utf8",
    ),
  );
  database.exec(
    [
      'CREATE TABLE "_campfire_migrations" (',
      '  "name" TEXT PRIMARY KEY,',
      '  "applied_at" TEXT NOT NULL DEFAULT (datetime(\'now\'))',
      ');',
      'INSERT INTO "_campfire_migrations" ("name") VALUES (\'0001_init\');',
      'INSERT INTO "User" ("id", "email", "username", "passwordHash", "updatedAt")',
      "VALUES",
      "  ('legacy-owner', 'owner@legacy.test', 'legacy_owner', 'hash', CURRENT_TIMESTAMP),",
      "  ('legacy-member', 'member@legacy.test', 'legacy_member', 'hash', CURRENT_TIMESTAMP);",
      'INSERT INTO "Server" ("id", "name", "ownerId", "inviteCode")',
      "VALUES ('legacy-server', 'Legacy Camp', 'legacy-owner', 'legacy-invite');",
      'INSERT INTO "Channel" ("id", "serverId", "name")',
      "VALUES ('legacy-channel', 'legacy-server', 'general');",
      'INSERT INTO "Message" ("id", "channelId", "authorId", "content", "updatedAt")',
      "VALUES ('legacy-message', 'legacy-channel', 'legacy-owner', 'still here', CURRENT_TIMESTAMP);",
      'INSERT INTO "Friendship" ("id", "requesterId", "addresseeId", "status", "createdAt", "updatedAt")',
      "VALUES ('legacy-block', 'legacy-member', 'legacy-owner', 'blocked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);",
      "PRAGMA user_version = 0;",
    ].join("\n"),
  );
  database.close();

  mkdirSync(join(root, "uploads"), { recursive: true });
  mkdirSync(join(root, "avatars"), { recursive: true });
  writeFileSync(join(root, "uploads", "legacy.txt"), "legacy upload");
  writeFileSync(join(root, "avatars", "legacy.png"), "legacy avatar");
  writeFileSync(join(root, "secret"), "a".repeat(64));
  return databasePath;
}

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
  it("imports the real installed v0.0.3 state layout without modifying its source", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-v003-installed-"));
    temporaryDirectories.push(root);
    const legacyDatabasePath = createV003DesktopState(root);

    const result = await importLegacyDesktopState({
      userDataPath: root,
      portableDirectory: null,
      Database,
      log: () => undefined,
    });

    expect(result.status).toBe("imported");
    expect(existsSync(legacyDatabasePath)).toBe(true);
    expect(readFileSync(join(root, "media", "uploads", "legacy.txt"), "utf8"))
      .toBe("legacy upload");
    expect(readFileSync(join(root, "media", "avatars", "legacy.png"), "utf8"))
      .toBe("legacy avatar");

    const imported = new Database(join(root, "data", "campfire.db"), {
      readonly: true,
    });
    expect(imported.pragma("user_version", { simple: true })).toBe(
      DESKTOP_SCHEMA_VERSION,
    );
    expect(
      imported.prepare('SELECT "content" FROM "Message" WHERE "id" = ?').get(
        "legacy-message",
      ),
    ).toEqual({ content: "still here" });
    for (const table of ["WebhookEvent", "Report"]) {
      expect(
        imported
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get(table),
      ).toBeTruthy();
    }
    imported.close();
  });

  it("imports committed WAL pages without rewriting the legacy database", async () => {
    const root = mkdtempSync(join(tmpdir(), "campfire-v003-wal-"));
    temporaryDirectories.push(root);
    const legacyDatabasePath = createV003DesktopState(root);
    const writer = new Database(legacyDatabasePath);

    try {
      writer.pragma("journal_mode = WAL");
      writer.pragma("wal_autocheckpoint = 0");
      writer
        .prepare(
          'INSERT INTO "Message" ("id", "channelId", "authorId", "content", "updatedAt") VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
        )
        .run(
          "legacy-wal-message",
          "legacy-channel",
          "legacy-owner",
          "committed in WAL",
        );

      const legacyWalPath = legacyDatabasePath + "-wal";
      const databaseBefore = readFileSync(legacyDatabasePath);
      const walBefore = readFileSync(legacyWalPath);

      await importLegacyDesktopState({
        userDataPath: root,
        portableDirectory: null,
        Database,
        log: () => undefined,
      });

      expect(readFileSync(legacyDatabasePath)).toEqual(databaseBefore);
      expect(readFileSync(legacyWalPath)).toEqual(walBefore);
      const imported = new Database(join(root, "data", "campfire.db"), {
        readonly: true,
      });
      expect(
        imported
          .prepare('SELECT "content" FROM "Message" WHERE "id" = ?')
          .get("legacy-wal-message"),
      ).toEqual({ content: "committed in WAL" });
      imported.close();
    } finally {
      writer.close();
    }
  });

  it("imports the real portable v0.0.3 layout exactly once", async () => {
    const portableDirectory = mkdtempSync(
      join(tmpdir(), "campfire-v003-portable-"),
    );
    temporaryDirectories.push(portableDirectory);
    const legacyRoot = join(portableDirectory, "data");
    const userDataPath = join(portableDirectory, "CampfireData");
    mkdirSync(legacyRoot, { recursive: true });
    const legacyDatabasePath = createV003DesktopState(legacyRoot);
    const messages: string[] = [];

    const first = await importLegacyDesktopState({
      userDataPath,
      portableDirectory,
      Database,
      log: (message: string) => messages.push(message),
    });
    const second = await importLegacyDesktopState({
      userDataPath,
      portableDirectory,
      Database,
      log: (message: string) => messages.push(message),
    });

    expect(first).toMatchObject({
      status: "imported",
      legacyRoot,
      copiedMedia: true,
      preservedJwtSecret: true,
    });
    expect(second).toMatchObject({ status: "existing-beta" });
    expect(existsSync(legacyDatabasePath)).toBe(true);
    expect(
      readFileSync(
        join(userDataPath, "media", "uploads", "legacy.txt"),
        "utf8",
      ),
    ).toBe("legacy upload");
    expect(
      JSON.parse(
        readFileSync(join(userDataPath, "desktop-config.json"), "utf8"),
      ).jwtSecret,
    ).toBe("a".repeat(64));
    expect(messages.some((message) => message.includes("Imported v0.0.3")))
      .toBe(true);
  });

  it("refuses to overwrite beta state when legacy portable state is also present", async () => {
    const portableDirectory = mkdtempSync(
      join(tmpdir(), "campfire-v003-conflict-"),
    );
    temporaryDirectories.push(portableDirectory);
    const legacyRoot = join(portableDirectory, "data");
    const userDataPath = join(portableDirectory, "CampfireData");
    mkdirSync(legacyRoot, { recursive: true });
    mkdirSync(userDataPath, { recursive: true });
    const legacyDatabasePath = createV003DesktopState(legacyRoot);
    const betaConfig = { jwtSecret: "b".repeat(96) };
    writeFileSync(
      join(userDataPath, "desktop-config.json"),
      JSON.stringify(betaConfig),
    );

    const result = await importLegacyDesktopState({
      userDataPath,
      portableDirectory,
      Database,
      log: () => undefined,
    });

    expect(result).toMatchObject({ status: "conflict" });
    expect(
      JSON.parse(
        readFileSync(join(userDataPath, "desktop-config.json"), "utf8"),
      ),
    ).toEqual(betaConfig);
    expect(existsSync(join(userDataPath, "data", "campfire.db"))).toBe(false);
    expect(existsSync(legacyDatabasePath)).toBe(true);
  });

  it("leaves both roots unchanged when a legacy import cannot be upgraded", async () => {
    const portableDirectory = mkdtempSync(
      join(tmpdir(), "campfire-v003-failure-"),
    );
    temporaryDirectories.push(portableDirectory);
    const legacyRoot = join(portableDirectory, "data");
    const userDataPath = join(portableDirectory, "CampfireData");
    mkdirSync(legacyRoot, { recursive: true });
    const legacyDatabasePath = createV003DesktopState(legacyRoot);
    const legacy = new Database(legacyDatabasePath);
    legacy
      .prepare('UPDATE "User" SET "stripeCustomerId" = ?')
      .run("cus_duplicate");
    legacy.close();
    const messages: string[] = [];

    await expect(
      importLegacyDesktopState({
        userDataPath,
        portableDirectory,
        Database,
        log: (message: string) => messages.push(message),
      }),
    ).rejects.toThrow(/stripeCustomerId has duplicates/);

    expect(existsSync(join(userDataPath, "data"))).toBe(false);
    expect(existsSync(join(userDataPath, "media"))).toBe(false);
    expect(existsSync(join(userDataPath, "desktop-config.json"))).toBe(false);
    const unchanged = new Database(legacyDatabasePath, { readonly: true });
    expect(unchanged.pragma("user_version", { simple: true })).toBe(0);
    expect(unchanged.prepare('SELECT COUNT(*) AS count FROM "User"').get())
      .toEqual({ count: 2 });
    unchanged.close();
    expect(messages.at(-1)).toContain("failed safely");
  });

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

  it("upgrades pre-beta v4 databases that predate reports and webhooks", () => {
    const { databasePath, directory } = createLegacyDatabase();
    upgradeDesktopDatabase({
      databasePath,
      Database,
      log: () => undefined,
    });

    const legacyV4 = new Database(databasePath);
    legacyV4.exec('DROP TABLE "Report"; DROP TABLE "WebhookEvent";');
    legacyV4.pragma("user_version = 4");
    legacyV4.close();

    const backupsBefore = readdirSync(join(directory, "backups")).length;
    const result = upgradeDesktopDatabase({
      databasePath,
      Database,
      log: () => undefined,
    });

    expect(result.upgraded).toBe(true);
    expect(result.backupPath).toMatch(/\.pre-v5\./);
    expect(result.backupPath && existsSync(result.backupPath)).toBe(true);

    const database = new Database(databasePath, { readonly: true });
    expect(database.pragma("user_version", { simple: true })).toBe(5);
    expect(database.prepare('SELECT COUNT(*) AS count FROM "User"').get())
      .toEqual({ count: 2 });
    for (const table of ["WebhookEvent", "Report"]) {
      expect(
        database
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
          .get(table),
      ).toBeTruthy();
    }
    for (const index of [
      "Report_targetUserId_status_idx",
      "Report_reporterId_idx",
    ]) {
      expect(
        database
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get(index),
      ).toBeTruthy();
    }
    const reportForeignKeys = database
      .prepare('PRAGMA foreign_key_list("Report")')
      .all() as Array<{ from: string; table: string; on_delete: string }>;
    expect(reportForeignKeys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: "reporterId", table: "User", on_delete: "CASCADE" }),
        expect.objectContaining({ from: "targetUserId", table: "User", on_delete: "CASCADE" }),
      ]),
    );
    database.close();

    const backupsAfterUpgrade = readdirSync(join(directory, "backups")).length;
    expect(backupsAfterUpgrade).toBe(backupsBefore + 1);
    expect(
      upgradeDesktopDatabase({ databasePath, Database, log: () => undefined }),
    ).toEqual({ upgraded: false, backupPath: null });
    expect(readdirSync(join(directory, "backups"))).toHaveLength(backupsAfterUpgrade);
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

  it("imports legacy state before creating fresh beta state", () => {
    const mainSource = readFileSync(
      new URL("../desktop/main.cjs", import.meta.url),
      "utf8",
    );
    const importPosition = mainSource.indexOf("importLegacyDesktopState({");
    const configPosition = mainSource.indexOf(
      "const desktopConfig = ensureDesktopConfig();",
    );
    const databasePosition = mainSource.indexOf(
      "const databasePath = ensureDatabase(serverRoot);",
    );

    expect(importPosition).toBeGreaterThan(0);
    expect(configPosition).toBeGreaterThan(importPosition);
    expect(databasePosition).toBeGreaterThan(importPosition);
  });
});
