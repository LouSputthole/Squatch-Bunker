#!/usr/bin/env node
/**
 * Campfire build — cross-platform port of the old build.sh.
 *
 * Prisma 7 does not support env() in the datasource provider field, so we
 * temporarily rewrite prisma/schema.prisma to match DB_PROVIDER, generate +
 * build, then restore the original bytes — even if the build fails. Same
 * schema-swap approach as postinstall.mjs (regex on the datasource line only).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = join(root, "prisma", "schema.prisma");

// Detect DB_PROVIDER from DATABASE_URL if not already set.
// When DATABASE_URL is unset or starts with "file:", default to sqlite.
let dbProvider = process.env.DB_PROVIDER;
if (!dbProvider) {
  const dbUrl = process.env.DATABASE_URL || "";
  dbProvider = !dbUrl || dbUrl.startsWith("file:") ? "sqlite" : "postgresql";
}

console.log(`[Campfire] Using DB_PROVIDER=${dbProvider}`);

// Rewrite schema provider to match DB_PROVIDER, then restore after generate/build.
const originalSchema = readFileSync(schemaPath, "utf8");
const swappedSchema = originalSchema.replace(
  /provider = "(?:sqlite|postgresql)"/,
  `provider = "${dbProvider}"`,
);
if (swappedSchema !== originalSchema) {
  writeFileSync(schemaPath, swappedSchema);
}

// Ensure DATABASE_URL has a default for SQLite if not set
const env = { ...process.env, DB_PROVIDER: dbProvider };
if (!env.DATABASE_URL && dbProvider === "sqlite") {
  env.DATABASE_URL = "file:./dev.db";
}

try {
  execSync("npx prisma generate", { cwd: root, stdio: "inherit", env });
  execSync("npx next build", { cwd: root, stdio: "inherit", env });
} finally {
  // Restore schema provider on exit, whether the build succeeded or not.
  if (swappedSchema !== originalSchema) {
    writeFileSync(schemaPath, originalSchema);
  }
}
