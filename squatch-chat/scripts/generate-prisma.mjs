#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const sqliteSchemaPath = join(root, "prisma", "schema.prisma");
export const postgresqlSchemaPath = join(root, "prisma", "schema.postgresql.prisma");
const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");
const generatedHeader = [
  "// AUTO-GENERATED from prisma/schema.prisma. Do not edit directly.",
  "// Run `npm run db:generate` after changing the canonical SQLite schema.",
  "",
].join("\n");

function replaceExactlyOnce(source, pattern, replacement, description) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = source.match(new RegExp(pattern.source, flags));
  if (matches?.length !== 1) {
    throw new Error(`Expected exactly one ${description}; found ${matches?.length ?? 0}`);
  }
  return source.replace(pattern, replacement);
}

export function derivePostgresqlSchema(sqliteSchema) {
  let derived = replaceExactlyOnce(
    sqliteSchema,
    /(^\s*output\s*=\s*")\.\.\/generated\/prisma("\s*$)/m,
    "$1../generated/prisma-postgresql$2",
    "SQLite Prisma Client output",
  );
  derived = replaceExactlyOnce(
    derived,
    /(datasource\s+db\s*\{[\s\S]*?\bprovider\s*=\s*")sqlite("[\s\S]*?\})/,
    "$1postgresql$2",
    "SQLite datasource provider",
  );
  return `${generatedHeader}${derived}`;
}

export function syncPostgresqlSchema({ check = false } = {}) {
  const sqliteSchema = readFileSync(sqliteSchemaPath, "utf8");
  const expected = derivePostgresqlSchema(sqliteSchema);
  const actual = existsSync(postgresqlSchemaPath)
    ? readFileSync(postgresqlSchemaPath, "utf8")
    : null;

  if (actual === expected) return false;
  if (check) {
    throw new Error(
      "prisma/schema.postgresql.prisma drifted from prisma/schema.prisma; run `npm run db:generate`",
    );
  }
  writeFileSync(postgresqlSchemaPath, expected);
  console.log("[Campfire] Derived prisma/schema.postgresql.prisma from the canonical SQLite schema.");
  return true;
}

function runPrisma(configPath) {
  const result = spawnSync(
    process.execPath,
    [prismaCli, "generate", "--config", configPath],
    { cwd: root, env: process.env, stdio: "inherit", shell: false },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Prisma generate failed for ${configPath} with exit code ${result.status}`);
  }
}

function main() {
  const check = process.argv.includes("--check");
  const schemaOnly = process.argv.includes("--schema-only");
  syncPostgresqlSchema({ check });
  if (check) {
    console.log("[Campfire] Derived PostgreSQL schema is in sync.");
    return;
  }
  if (schemaOnly) return;

  runPrisma(join(root, "prisma.config.ts"));
  runPrisma(join(root, "prisma.postgresql.config.ts"));
  console.log("[Campfire] Generated matching SQLite and PostgreSQL Prisma clients.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error("[Campfire] Prisma generation failed:", error);
    process.exitCode = 1;
  }
}
