#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");
const sqliteConfig = join(root, "prisma.config.ts");
const sqliteSchema = join(root, "prisma", "schema.prisma");

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQLite identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function parsePlainIdentifierList(source, description) {
  const tokens = source.split(",").map((token) => token.trim());
  if (
    tokens.length === 0 ||
    tokens.some((token) => !/^"[A-Za-z_][A-Za-z0-9_]*"$/.test(token))
  ) {
    throw new Error(`${description} must contain only plain quoted identifiers`);
  }
  return tokens.map((token) => token.slice(1, -1));
}

function isNullInitializedDefinition(definition) {
  return !/\b(?:NOT\s+NULL|DEFAULT|PRIMARY\s+KEY|GENERATED)\b/i.test(
    definition,
  );
}

function readEnvVar(key) {
  if (process.env[key]) return process.env[key];
  const envPath = join(root, ".env");
  if (!existsSync(envPath)) return "";
  const match = readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
}

function databasePathFromUrl(databaseUrl) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error("Safe SQLite sync requires a file: DATABASE_URL");
  }
  const value = decodeURIComponent(databaseUrl.slice("file:".length).split(/[?#]/, 1)[0]);
  if (!value || value === ":memory:") return null;
  return isAbsolute(value) ? value : resolve(root, value);
}

export function prismaEnvironment(
  databaseUrl,
  environment = process.env,
) {
  return { ...environment, DATABASE_URL: databaseUrl };
}

function runPrisma(args, { capture = false, databaseUrl } = {}) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    env: databaseUrl
      ? prismaEnvironment(databaseUrl)
      : process.env,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture
      ? `\n${result.stdout || ""}\n${result.stderr || ""}`.trimEnd()
      : "";
    throw new Error(`Prisma ${args.join(" ")} failed with ${result.status}${detail}`);
  }
  return capture ? result.stdout : "";
}

function tableColumns(database) {
  const result = new Map();
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all();
  for (const { name } of tables) {
    const columns = database
      .prepare(`PRAGMA table_info(${quoteIdentifier(name)})`)
      .all()
      .map((column) => column.name);
    result.set(name, new Set(columns));
  }
  return result;
}

function assertDatabaseIntegrity(database) {
  const integrity = database.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    throw new Error(`SQLite integrity_check failed: ${integrity}`);
  }
  const foreignKeyProblems = database.pragma("foreign_key_check");
  if (foreignKeyProblems.length > 0) {
    throw new Error(
      `SQLite foreign_key_check found ${foreignKeyProblems.length} violation(s)`,
    );
  }
}

function sqliteTableExists(database, table) {
  return Boolean(
    database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
      )
      .get(table),
  );
}

export function migrateLegacySqliteData(database) {
  if (
    !sqliteTableExists(database, "Friendship") ||
    !sqliteTableExists(database, "UserBlock")
  ) {
    return { migratedBlocks: 0, removedLegacyRows: 0 };
  }

  const migrate = database.transaction(() => {
    const inserted = database
      .prepare(
        [
          'INSERT OR IGNORE INTO "UserBlock" (',
          '  "id", "blockerId", "blockedId", "createdAt"',
          ')',
          "SELECT",
          '  \'legacy-block-\' || "id",',
          '  "addresseeId",',
          '  "requesterId",',
          '  "updatedAt"',
          'FROM "Friendship"',
          'WHERE "status" = \'blocked\'',
          '  AND "addresseeId" <> "requesterId"',
        ].join("\n"),
      )
      .run();
    const removed = database
      .prepare('DELETE FROM "Friendship" WHERE "status" = ?')
      .run("blocked");
    return {
      migratedBlocks: inserted.changes,
      removedLegacyRows: removed.changes,
    };
  });

  return migrate();
}

function legacyBlockCount(database) {
  if (
    !sqliteTableExists(database, "Friendship") ||
    !sqliteTableExists(database, "UserBlock")
  ) {
    return 0;
  }
  return database
    .prepare(
      'SELECT COUNT(*) AS count FROM "Friendship" WHERE "status" = ?',
    )
    .get("blocked").count;
}

export function analyseSqliteDiff(sql, existingColumns) {
  const withoutComments = sql.replace(/^\s*--.*$/gm, "").trim();
  if (!withoutComments) {
    return { hasChanges: false, uniqueIndexes: [], nullInitializedColumns: new Set() };
  }

  const statements = withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  const nullInitializedColumns = new Set();
  for (const statement of statements) {
    const createTable = statement.match(
      /^CREATE TABLE "([^"]+)"\s*\(([\s\S]*)\)$/i,
    );
    if (createTable) {
      const physicalTable = createTable[1];
      const strippedTable = physicalTable.startsWith("new_")
        ? physicalTable.slice(4)
        : physicalTable;
      const table = existingColumns.has(strippedTable)
        ? strippedTable
        : physicalTable;
      const existing = existingColumns.get(table);
      if (!existing) continue;

      for (const sourceLine of createTable[2].split(/\r?\n/)) {
        const line = sourceLine.trim().replace(/,$/, "");
        const column = line.match(
          /^"([A-Za-z_][A-Za-z0-9_]*)"\s+(.+)$/,
        );
        if (!column || existing.has(column[1])) continue;
        if (isNullInitializedDefinition(column[2])) {
          nullInitializedColumns.add(`${table}.${column[1]}`);
        }
      }
      continue;
    }

    const addedColumn = statement.match(
      /^ALTER TABLE "([^"]+)" ADD COLUMN "([A-Za-z_][A-Za-z0-9_]*)"\s+([\s\S]+)$/i,
    );
    if (!addedColumn) continue;
    const [, table, column, definition] = addedColumn;
    const existing = existingColumns.get(table);
    if (
      existing &&
      !existing.has(column) &&
      isNullInitializedDefinition(definition)
    ) {
      nullInitializedColumns.add(`${table}.${column}`);
    }
  }

  const redefinitions = new Map();
  const insertPattern =
    /INSERT INTO "new_([^"]+)"\s*\(([^)]*)\)\s*SELECT\s+([^;]*?)\s+FROM\s+"([^"]+)"/gi;
  for (const match of sql.matchAll(insertPattern)) {
    const [, temporaryBase, destinationList, sourceList, sourceTable] = match;
    const destinationColumns = parsePlainIdentifierList(
      destinationList,
      `SQLite rebuild destination for ${sourceTable}`,
    );
    const sourceColumns = parsePlainIdentifierList(
      sourceList,
      `SQLite rebuild source for ${sourceTable}`,
    );
    if (
      temporaryBase !== sourceTable ||
      destinationColumns.length !== sourceColumns.length ||
      destinationColumns.some((column, index) => column !== sourceColumns[index])
    ) {
      throw new Error(`SQLite table rebuild for ${sourceTable} changes column mappings`);
    }
    redefinitions.set(sourceTable, new Set(sourceColumns));
  }

  for (const match of sql.matchAll(/DROP TABLE "([^"]+)"/gi)) {
    const table = match[1];
    const copiedColumns = redefinitions.get(table);
    if (!copiedColumns) {
      throw new Error(`SQLite diff drops ${table} without a data-preserving rebuild`);
    }
    for (const column of existingColumns.get(table) ?? []) {
      if (!copiedColumns.has(column)) {
        throw new Error(`SQLite rebuild of ${table} omits existing column ${column}`);
      }
    }
    if (!sql.includes(`ALTER TABLE "new_${table}" RENAME TO "${table}"`)) {
      throw new Error(`SQLite rebuild of ${table} does not restore the original table name`);
    }
  }

  const allowedStatements = [
    /^PRAGMA\s+(?:defer_)?foreign_keys\s*=/i,
    /^ALTER TABLE "[^"]+" ADD COLUMN /i,
    /^CREATE TABLE "[^"]+"/i,
    /^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "[^"]+"/i,
    /^INSERT INTO "new_[^"]+"/i,
    /^DROP TABLE "[^"]+"$/i,
    /^ALTER TABLE "new_[^"]+" RENAME TO "[^"]+"$/i,
  ];
  for (const statement of statements) {
    if (!allowedStatements.some((pattern) => pattern.test(statement))) {
      throw new Error(
        `SQLite diff contains an unapproved statement: ${statement.split(/\r?\n/, 1)[0]}`,
      );
    }
  }

  const uniqueIndexes = [];
  const uniquePattern =
    /CREATE UNIQUE INDEX\s+"([^"]+)"\s+ON\s+"([^"]+)"\s*\(([^)]+)\)/gi;
  for (const match of sql.matchAll(uniquePattern)) {
    const columns = parsePlainIdentifierList(
      match[3],
      `Unique index ${match[1]}`,
    );
    uniqueIndexes.push({ name: match[1], table: match[2], columns });
  }

  return { hasChanges: true, uniqueIndexes, nullInitializedColumns };
}

function assertUniqueIndexesSafe(
  database,
  existingColumns,
  uniqueIndexes,
  nullInitializedColumns,
) {
  for (const index of uniqueIndexes) {
    const tableColumnsForIndex = existingColumns.get(index.table);
    if (!tableColumnsForIndex) continue;
    const newColumns = index.columns.filter(
      (column) => !tableColumnsForIndex.has(column),
    );
    if (newColumns.length > 0) {
      const hasNullInitializedColumn = newColumns.some((column) =>
        nullInitializedColumns.has(`${index.table}.${column}`),
      );
      if (hasNullInitializedColumn) continue;
      throw new Error(
        `Unique index ${index.name} targets new column ${index.table}.${newColumns[0]}; review manually`,
      );
    }
    const table = quoteIdentifier(index.table);
    const columns = index.columns.map(quoteIdentifier);
    const where = columns.map((column) => `${column} IS NOT NULL`).join(" AND ");
    const duplicate = database
      .prepare(
        `SELECT 1 FROM ${table} WHERE ${where} GROUP BY ${columns.join(", ")} HAVING COUNT(*) > 1 LIMIT 1`,
      )
      .get();
    if (duplicate) {
      throw new Error(
        `Unique index ${index.name} would reject duplicate values in ${index.table}`,
      );
    }
  }
}

export function databaseContentFingerprint(databasePath) {
  return createHash("sha256").update(readFileSync(databasePath)).digest("hex");
}

export function checkpointedDatabaseContentFingerprint(databasePath) {
  const database = new Database(databasePath, { fileMustExist: true });
  try {
    assertDatabaseIntegrity(database);
    const checkpoint = database.pragma("wal_checkpoint(TRUNCATE)");
    if (checkpoint.some((entry) => entry.busy)) {
      throw new Error(
        "SQLite database is busy; stop Campfire before synchronizing it",
      );
    }
    return databaseContentFingerprint(databasePath);
  } finally {
    database.close();
  }
}

function backupPathFor(databasePath) {
  const backupDirectory = join(dirname(databasePath), "backups");
  mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(backupDirectory, `${basename(databasePath)}.${timestamp}.bak`);
}

function restoreBackup(databasePath, backupPath) {
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
  copyFileSync(backupPath, databasePath);
}

function currentDiffSql(databaseUrl) {
  return runPrisma(
    [
      "migrate",
      "diff",
      "--config",
      sqliteConfig,
      "--from-config-datasource",
      "--to-schema",
      sqliteSchema,
      "--script",
    ],
    { capture: true, databaseUrl },
  );
}

export function syncSqlite() {
  const databaseUrl = readEnvVar("DATABASE_URL") || "file:./data/campfire.db";
  const databasePath = databasePathFromUrl(databaseUrl);
  if (!databasePath || !existsSync(databasePath)) {
    if (databasePath) mkdirSync(dirname(databasePath), { recursive: true });
    runPrisma(["db", "push", "--config", sqliteConfig], { databaseUrl });
    return;
  }

  let existingColumns;
  let pendingLegacyBlocks;
  {
    const database = new Database(databasePath);
    try {
      assertDatabaseIntegrity(database);
      const checkpoint = database.pragma("wal_checkpoint(TRUNCATE)");
      if (checkpoint.some((entry) => entry.busy)) {
        throw new Error(
          "SQLite database is busy; stop Campfire before synchronizing it",
        );
      }
      existingColumns = tableColumns(database);
      pendingLegacyBlocks = legacyBlockCount(database);
    } finally {
      database.close();
    }
  }

  const beforeDiff = checkpointedDatabaseContentFingerprint(databasePath);
  const sql = currentDiffSql(databaseUrl);
  const analysis = analyseSqliteDiff(sql, existingColumns);
  if (!analysis.hasChanges && pendingLegacyBlocks === 0) {
    console.log("[Campfire] Existing SQLite database is already in sync.");
    return;
  }

  {
    const database = new Database(databasePath, { fileMustExist: true });
    try {
      assertDatabaseIntegrity(database);
      assertUniqueIndexesSafe(
        database,
        existingColumns,
        analysis.uniqueIndexes,
        analysis.nullInitializedColumns,
      );
    } finally {
      database.close();
    }
  }
  if (checkpointedDatabaseContentFingerprint(databasePath) !== beforeDiff) {
    throw new Error("SQLite database changed during upgrade analysis; stop Campfire and retry");
  }

  const backupPath = backupPathFor(databasePath);
  copyFileSync(databasePath, backupPath);
  console.log(`[Campfire] Backed up SQLite database to ${backupPath}`);

  try {
    if (analysis.hasChanges) {
      runPrisma([
        "db",
        "push",
        "--config",
        sqliteConfig,
        "--accept-data-loss",
      ], { databaseUrl });
    }
    const database = new Database(databasePath, { fileMustExist: true });
    let upgradedColumns;
    try {
      assertDatabaseIntegrity(database);
      const dataMigration = migrateLegacySqliteData(database);
      if (dataMigration.removedLegacyRows > 0) {
        console.log(
          "[Campfire] Migrated " +
            dataMigration.migratedBlocks +
            " legacy personal block(s).",
        );
      }
      assertDatabaseIntegrity(database);
      upgradedColumns = tableColumns(database);
    } finally {
      database.close();
    }
    if (analyseSqliteDiff(currentDiffSql(databaseUrl), upgradedColumns).hasChanges) {
      throw new Error("SQLite schema still drifted after db push");
    }
  } catch (error) {
    restoreBackup(databasePath, backupPath);
    throw new Error(
      `SQLite upgrade failed and the pre-upgrade backup was restored: ${error.message}`,
      { cause: error },
    );
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    syncSqlite();
  } catch (error) {
    console.error(
      "[Campfire] Safe SQLite sync refused the upgrade. Keep the database backup, review the schema change, and run `npm run db:push` manually.",
    );
    console.error(error);
    process.exitCode = 1;
  }
}
