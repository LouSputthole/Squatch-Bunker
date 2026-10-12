import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  analyseSqliteDiff,
  checkpointedDatabaseContentFingerprint,
  databaseContentFingerprint,
  migrateLegacyReports,
  migrateLegacySqliteData,
  prismaEnvironment,
  syncSqlite,
} from "@/scripts/sync-sqlite.mjs";

const Database = createRequire(import.meta.url)("better-sqlite3");

describe("safe SQLite sync", () => {
  it("pins Prisma subprocesses to the database URL that was inspected", () => {
    expect(
      prismaEnvironment("file:./data/expected.db", {
        DATABASE_URL: "file:./prisma/dev.db",
        NODE_ENV: "test",
      }),
    ).toEqual({
      DATABASE_URL: "file:./data/expected.db",
      NODE_ENV: "test",
    });
  });

  it("ignores sidecar churn but detects committed database changes", () => {
    const directory = mkdtempSync(join(tmpdir(), "campfire-sqlite-hash-"));
    const databasePath = join(directory, "campfire.db");

    try {
      const database = new Database(databasePath);
      database.pragma("journal_mode = WAL");
      database.exec(
        'CREATE TABLE "Marker" ("id" TEXT NOT NULL PRIMARY KEY)',
      );
      database.close();

      const before = checkpointedDatabaseContentFingerprint(databasePath);
      writeFileSync(databasePath + "-shm", "driver-sidecar-churn");
      expect(databaseContentFingerprint(databasePath)).toBe(before);
      rmSync(databasePath + "-shm", { force: true });

      const writer = new Database(databasePath);
      writer
        .prepare('INSERT INTO "Marker" ("id") VALUES (?)')
        .run("committed-change");
      writer.close();

      expect(checkpointedDatabaseContentFingerprint(databasePath)).not.toBe(
        before,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });


  it("accepts additive columns, tables, and indexes", () => {
    const result = analyseSqliteDiff(
      [
        'ALTER TABLE "User" ADD COLUMN "billingEventAt" DATETIME;',
        'CREATE TABLE "NewFeature" ("id" TEXT NOT NULL PRIMARY KEY);',
        'CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");',
      ].join("\n"),
      new Map([["User", new Set(["id", "stripeCustomerId"])]]),
    );
    expect(result.hasChanges).toBe(true);
    expect(result.uniqueIndexes).toEqual([
      {
        name: "User_stripeCustomerId_key",
        table: "User",
        columns: ["stripeCustomerId"],
      },
    ]);
  });

  it("accepts a table rebuild only when every existing column is copied", () => {
    const sql = [
      "PRAGMA foreign_keys=OFF;",
      'CREATE TABLE "new_Channel" ("id" TEXT, "name" TEXT, "topic" TEXT);',
      'INSERT INTO "new_Channel" ("id", "name") SELECT "id", "name" FROM "Channel";',
      'DROP TABLE "Channel";',
      'ALTER TABLE "new_Channel" RENAME TO "Channel";',
      "PRAGMA foreign_keys=ON;",
    ].join("\n");
    expect(() =>
      analyseSqliteDiff(
        sql,
        new Map([["Channel", new Set(["id", "name"])]]),
      ),
    ).not.toThrow();
    expect(() =>
      analyseSqliteDiff(
        sql,
        new Map([["Channel", new Set(["id", "name", "legacyValue"])]]),
      ),
    ).toThrow(/omits existing column legacyValue/);
  });

  it("recognizes only nullable, default-free rebuild columns as NULL-initialized", () => {
    const safeSql = [
      'CREATE TABLE "new_Message" (',
      '  "id" TEXT NOT NULL PRIMARY KEY,',
      '  "content" TEXT NOT NULL,',
      '  "privateUploadId" TEXT',
      ');',
      'INSERT INTO "new_Message" ("id", "content") SELECT "id", "content" FROM "Message";',
      'DROP TABLE "Message";',
      'ALTER TABLE "new_Message" RENAME TO "Message";',
      'CREATE UNIQUE INDEX "Message_privateUploadId_key" ON "Message"("privateUploadId");',
    ].join("\n");
    const existing = new Map([
      ["Message", new Set(["id", "content"])],
    ]);

    const safeResult = analyseSqliteDiff(safeSql, existing);
    expect(safeResult.nullInitializedColumns).toEqual(
      new Set(["Message.privateUploadId"]),
    );

    const defaultedSql = [
      'CREATE TABLE "new_Message" (',
      '  "id" TEXT NOT NULL PRIMARY KEY,',
      '  "content" TEXT NOT NULL,',
      '  "privateUploadId" TEXT DEFAULT \'shared\'',
      ');',
      'INSERT INTO "new_Message" ("id", "content") SELECT "id", "content" FROM "Message";',
      'DROP TABLE "Message";',
      'ALTER TABLE "new_Message" RENAME TO "Message";',
      'CREATE UNIQUE INDEX "Message_privateUploadId_key" ON "Message"("privateUploadId");',
    ].join("\n");

    const defaultedResult = analyseSqliteDiff(defaultedSql, existing);
    expect(defaultedResult.nullInitializedColumns).toEqual(new Set());
  });

  it("rejects destructive or unknown SQL", () => {
    expect(() =>
      analyseSqliteDiff(
        'ALTER TABLE "User" DROP COLUMN "bio";',
        new Map([["User", new Set(["id", "bio"])]]),
      ),
    ).toThrow(/unapproved statement/);
    expect(() =>
      analyseSqliteDiff(
        'DROP TABLE "Message";',
        new Map([["Message", new Set(["id"])]]),
      ),
    ).toThrow(/without a data-preserving rebuild/);
  });

  it("rejects expressions disguised by quoted identifiers in rebuild lists", () => {
    const sql = [
      'CREATE TABLE "new_User" ("id" TEXT, "name" TEXT);',
      'INSERT INTO "new_User" ("id", "name") SELECT "id", upper("name") FROM "User";',
      'DROP TABLE "User";',
      'ALTER TABLE "new_User" RENAME TO "User";',
    ].join("\n");
    expect(() =>
      analyseSqliteDiff(
        sql,
        new Map([["User", new Set(["id", "name"])]]),
      ),
    ).toThrow(/must contain only plain quoted identifiers/);
  });

  it("migrates legacy Friendship blocks directionally and idempotently", () => {
    const database = new Database(":memory:");
    database.exec(
      [
        'CREATE TABLE "Friendship" (',
        '  "id" TEXT NOT NULL PRIMARY KEY,',
        '  "requesterId" TEXT NOT NULL,',
        '  "addresseeId" TEXT NOT NULL,',
        '  "status" TEXT NOT NULL,',
        '  "updatedAt" DATETIME NOT NULL',
        ');',
        'CREATE TABLE "UserBlock" (',
        '  "id" TEXT NOT NULL PRIMARY KEY,',
        '  "blockerId" TEXT NOT NULL,',
        '  "blockedId" TEXT NOT NULL,',
        '  "createdAt" DATETIME NOT NULL,',
        '  UNIQUE ("blockerId", "blockedId")',
        ');',
        'INSERT INTO "Friendship" ("id", "requesterId", "addresseeId", "status", "updatedAt")',
        "VALUES",
        "  ('legacy-block', 'blocked-user', 'blocking-user', 'blocked', '2026-07-01T00:00:00Z'),",
        "  ('legacy-friend', 'friend-a', 'friend-b', 'accepted', '2026-07-01T00:00:00Z');",
      ].join("\n"),
    );

    expect(migrateLegacySqliteData(database)).toEqual({
      migratedBlocks: 1,
      removedLegacyRows: 1,
    });
    expect(
      database
        .prepare(
          'SELECT "id", "blockerId", "blockedId", "createdAt" FROM "UserBlock"',
        )
        .get(),
    ).toEqual({
      id: "legacy-block-legacy-block",
      blockerId: "blocking-user",
      blockedId: "blocked-user",
      createdAt: "2026-07-01T00:00:00Z",
    });
    expect(
      database.prepare('SELECT "status" FROM "Friendship"').all(),
    ).toEqual([{ status: "accepted" }]);
    expect(migrateLegacySqliteData(database)).toEqual({
      migratedBlocks: 0,
      removedLegacyRows: 0,
    });
    database.close();
  });

  it("backfills pre-desk reports from their message once the desk columns exist", () => {
    const database = new Database(":memory:");
    expect(migrateLegacyReports(database)).toEqual({ backfilledReports: 0 }); // no Report table yet
    database.exec(
      [
        'CREATE TABLE "Channel" ("id" TEXT NOT NULL PRIMARY KEY, "serverId" TEXT NOT NULL, "name" TEXT NOT NULL);',
        'CREATE TABLE "Message" (',
        '  "id" TEXT NOT NULL PRIMARY KEY, "channelId" TEXT NOT NULL, "content" TEXT NOT NULL,',
        '  "attachmentName" TEXT, "attachmentUrl" TEXT, "createdAt" DATETIME NOT NULL',
        ');',
        'CREATE TABLE "Report" (',
        '  "id" TEXT NOT NULL PRIMARY KEY, "reporterId" TEXT NOT NULL, "targetUserId" TEXT NOT NULL,',
        '  "messageId" TEXT, "serverId" TEXT, "reason" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT \'open\',',
        '  "createdAt" DATETIME NOT NULL, "evidenceContent" TEXT, "evidenceAttachmentName" TEXT,',
        '  "evidenceAttachmentUrl" TEXT, "evidenceChannelId" TEXT, "evidenceChannelName" TEXT, "evidenceMessageAt" DATETIME',
        ');',
        'CREATE TABLE "ReportEvent" (',
        '  "id" TEXT NOT NULL PRIMARY KEY, "reportId" TEXT NOT NULL, "actorId" TEXT, "type" TEXT NOT NULL,',
        '  "detail" TEXT, "createdAt" DATETIME NOT NULL',
        ');',
        'INSERT INTO "Channel" VALUES (\'chan\', \'camp\', \'general\');',
        'INSERT INTO "Message" VALUES (\'msg\', \'chan\', \'the evidence\', \'pic.png\', \'/uploads/pic.png\', \'2026-09-01T00:00:00Z\');',
        'INSERT INTO "Report" ("id", "reporterId", "targetUserId", "messageId", "reason", "createdAt")',
        "VALUES ('legacy', 'reporter', 'target', 'msg', 'rude', '2026-09-02T00:00:00Z'),",
        "       ('orphan', 'reporter', 'target', 'gone', 'gone', '2026-09-03T00:00:00Z');",
      ].join("\n"),
    );

    expect(migrateLegacyReports(database)).toEqual({ backfilledReports: 1 });
    expect(
      database
        .prepare('SELECT "serverId", "evidenceContent", "evidenceAttachmentName", "evidenceChannelName", "evidenceMessageAt" FROM "Report" WHERE "id" = ?')
        .get("legacy"),
    ).toEqual({
      serverId: "camp",
      evidenceContent: "the evidence",
      evidenceAttachmentName: "pic.png",
      evidenceChannelName: "general",
      evidenceMessageAt: "2026-09-01T00:00:00Z",
    });
    expect(database.prepare('SELECT "serverId" FROM "Report" WHERE "id" = ?').get("orphan")).toEqual({ serverId: null });
    expect(database.prepare('SELECT "id", "type", "actorId" FROM "ReportEvent" ORDER BY "createdAt"').all()).toEqual([
      { id: "legacy-filed-legacy", type: "filed", actorId: "reporter" },
      { id: "legacy-filed-orphan", type: "filed", actorId: "reporter" },
    ]);
    expect(migrateLegacyReports(database)).toEqual({ backfilledReports: 0 });
    database.close();
  });

  it("backs up and migrates legacy blocks through the public sync path without schema drift", () => {
    const directory = mkdtempSync(join(tmpdir(), "campfire-sqlite-sync-"));
    const databasePath = join(directory, "campfire.db");
    const databaseUrl = "file:" + databasePath.replaceAll("\\", "/");
    const previousDatabaseUrl = process.env.DATABASE_URL;

    try {
      process.env.DATABASE_URL = databaseUrl;
      syncSqlite();

      const database = new Database(databasePath);
      database.pragma("journal_mode = WAL");
      database.exec(
        [
          'INSERT INTO "User" ("id", "email", "username", "passwordHash", "updatedAt")',
          "VALUES",
          "  ('sync-blocker', 'blocker@sync.test', 'sync_blocker', 'hash', CURRENT_TIMESTAMP),",
          "  ('sync-blocked', 'blocked@sync.test', 'sync_blocked', 'hash', CURRENT_TIMESTAMP);",
          'INSERT INTO "Friendship" (',
          '  "id", "requesterId", "addresseeId", "status", "createdAt", "updatedAt"',
          ") VALUES (",
          "  'sync-legacy-block', 'sync-blocked', 'sync-blocker', 'blocked', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP",
          ");",
        ].join("\n"),
      );
      database.close();

      syncSqlite();

      const migrated = new Database(databasePath, { readonly: true });
      const migratedBlock =
        migrated
          .prepare(
            'SELECT "blockerId", "blockedId" FROM "UserBlock" WHERE "id" = ?',
          )
          .get("legacy-block-sync-legacy-block");
      const legacyBlockCount =
        migrated
          .prepare(
            'SELECT COUNT(*) AS count FROM "Friendship" WHERE "status" = ?',
          )
          .get("blocked");
      migrated.close();

      expect(migratedBlock).toEqual({
        blockerId: "sync-blocker",
        blockedId: "sync-blocked",
      });
      expect(legacyBlockCount).toEqual({ count: 0 });

      const backupDirectory = join(directory, "backups");
      expect(readdirSync(backupDirectory)).toHaveLength(1);
      syncSqlite();
      expect(readdirSync(backupDirectory)).toHaveLength(1);
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
