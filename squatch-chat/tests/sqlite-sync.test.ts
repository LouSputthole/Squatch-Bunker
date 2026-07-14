import { describe, expect, it } from "vitest";
import {
  analyseSqliteDiff,
  prismaEnvironment,
} from "@/scripts/sync-sqlite.mjs";

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
});
