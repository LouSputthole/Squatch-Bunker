#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { syncPostgresqlSchema } from "./generate-prisma.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prismaCli = join(root, "node_modules", "prisma", "build", "index.js");
const postgresqlMigrations = join(root, "prisma", "migrations-postgresql");

function fail(message) {
  throw new Error(`[Campfire] Prisma pipeline check failed: ${message}`);
}

function runPrisma(args) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(`Prisma ${args.join(" ")} exited with ${result.status}`);
  }
}

function assertGeneratedProvider(relativePath, provider) {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    fail(`${relativePath} is missing; run npm run db:generate`);
  }
  const source = readFileSync(path, "utf8");
  if (!source.includes(`"activeProvider": "${provider}"`)) {
    fail(`${relativePath} was not generated for ${provider}`);
  }
}

function checkPostgresqlHistory() {
  const lockPath = join(postgresqlMigrations, "migration_lock.toml");
  if (!existsSync(lockPath)) fail("PostgreSQL migration lock is missing");
  if (!/provider\s*=\s*"postgresql"/.test(readFileSync(lockPath, "utf8"))) {
    fail("PostgreSQL migration lock has the wrong provider");
  }

  const migrationDirs = readdirSync(postgresqlMigrations, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (migrationDirs.length === 0 || migrationDirs[0] !== "20260711000000_init") {
    fail("the history-preserving PostgreSQL baseline is missing");
  }

  const sql = migrationDirs
    .map((directory) => {
      const path = join(postgresqlMigrations, directory, "migration.sql");
      if (!existsSync(path)) fail(`${directory}/migration.sql is missing`);
      return readFileSync(path, "utf8");
    })
    .join("\n");

  if (/\b(?:PRAGMA|AUTOINCREMENT)\b/i.test(sql)) {
    fail("SQLite-only SQL leaked into the PostgreSQL migration track");
  }
  for (const invariant of [
    'CREATE SCHEMA IF NOT EXISTS "public"',
    '"Friendship_pair_key"',
    '"UserBlock_no_self_check"',
    '"Channel_retentionDays_check"',
    '"Gathering_durationMinutes_check"',
    '"GatheringRsvp_status_check"',
  ]) {
    if (!sql.includes(invariant)) {
      fail(`PostgreSQL migration history is missing ${invariant}`);
    }
  }
}

try {
  syncPostgresqlSchema({ check: true });
  runPrisma(["validate", "--config", join(root, "prisma.config.ts")]);
  runPrisma(["validate", "--config", join(root, "prisma.postgresql.config.ts")]);
  assertGeneratedProvider("generated/prisma/internal/class.ts", "sqlite");
  assertGeneratedProvider(
    "generated/prisma-postgresql/internal/class.ts",
    "postgresql",
  );
  checkPostgresqlHistory();
  console.log("[Campfire] Prisma provider pipeline is internally consistent.");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
