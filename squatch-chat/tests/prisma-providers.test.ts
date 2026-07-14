import { spawnSync } from "node:child_process";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaPg } from "@prisma/adapter-pg";
import { describe, expect, it } from "vitest";
import { PrismaClient as PostgresqlPrismaClient } from "@/generated/prisma-postgresql/client";
import { PrismaClient as SqlitePrismaClient } from "@/generated/prisma/client";
import { createPrismaClient, isSQLiteUrl } from "@/lib/db";

describe("Prisma provider pipeline", () => {
  it.each([
    [undefined, true],
    ["", true],
    ["file:./data/campfire.db", true],
    ["postgresql://postgres:postgres@localhost:5432/campfire", false],
    ["postgres://postgres:postgres@localhost:5432/campfire", false],
  ])("classifies %s correctly", (databaseUrl, expected) => {
    expect(isSQLiteUrl(databaseUrl)).toBe(expected);
  });

  it("constructs SQLite with the SQLite-generated client", () => {
    expect(() => createPrismaClient("file::memory:")).not.toThrow();
  });

  it("constructs PostgreSQL with the PostgreSQL-generated client", () => {
    expect(() =>
      createPrismaClient(
        "postgresql://postgres:postgres@127.0.0.1:5432/campfire?schema=public",
      ),
    ).not.toThrow();
  });

  it("rejects a PostgreSQL adapter on the SQLite-generated client", () => {
    expect(
      () =>
        new SqlitePrismaClient({
          adapter: new PrismaPg(
            "postgresql://postgres:postgres@127.0.0.1:5432/campfire",
          ),
        }),
    ).toThrow(/not compatible/);
  });

  it("rejects a SQLite adapter on the PostgreSQL-generated client", () => {
    expect(
      () =>
        new PostgresqlPrismaClient({
          adapter: new PrismaBetterSqlite3({ url: "file::memory:" }),
        }),
    ).toThrow(/not compatible/);
  });

  it("keeps derived schemas, generated providers, and migration SQL aligned", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/check-prisma-pipeline.mjs"],
      { cwd: process.cwd(), encoding: "utf8", shell: false },
    );
    if (result.status !== 0) {
      throw new Error(`${result.stdout}\n${result.stderr}`);
    }
    expect(result.stdout).toContain("internally consistent");
  });
});
