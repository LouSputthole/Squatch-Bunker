#!/usr/bin/env node
/**
 * Campfire post-install — cross-platform (Node, runs on Windows/macOS/Linux).
 * Replaces the old bash-only postinstall.sh so `npm install` works everywhere.
 *
 * Zero-config self-host path:
 *   1. Create .env with SQLite defaults + a random JWT secret (if .env missing).
 *   2. Point the Prisma datasource provider at the right DB (Prisma 7 can't env() it).
 *   3. Generate the client; for SQLite also create the DB file so first run works.
 *
 * After this, `npm run host` just works. For Postgres, set DATABASE_URL in .env
 * before installing (or edit .env and run `npm run db:push`).
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const schemaPath = join(root, "prisma", "schema.prisma");

// 1. Create .env (SQLite, self-host defaults) if missing.
if (!existsSync(envPath)) {
  const secret = randomBytes(32).toString("hex");
  writeFileSync(
    envPath,
    [
      "# Auto-generated for local / self-host (SQLite, zero-config).",
      "# For the hosted/Postgres setup, set DATABASE_URL to a postgresql:// URL.",
      'DATABASE_URL="file:./data/campfire.db"',
      `JWT_SECRET="${secret}"`,
      "SOCKET_PORT=3001",
      "",
    ].join("\n"),
  );
  console.log("[Campfire] Created .env (SQLite self-host defaults, random JWT secret).");
}

// 2. Detect provider from DATABASE_URL (unset or file: => sqlite).
function readEnvVar(key) {
  if (existsSync(envPath)) {
    const m = readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return process.env[key] || "";
}
const dbUrl = readEnvVar("DATABASE_URL");
const provider = !dbUrl || dbUrl.startsWith("file:") ? "sqlite" : "postgresql";

// 3. Ensure the datasource provider matches (only touches the datasource line —
//    the generator line is provider = "prisma-client", which the alternation skips).
const schema = readFileSync(schemaPath, "utf8");
const fixed = schema.replace(/provider = "(?:sqlite|postgresql)"/, `provider = "${provider}"`);
if (fixed !== schema) {
  writeFileSync(schemaPath, fixed);
  console.log(`[Campfire] Set Prisma datasource provider to "${provider}".`);
}

// 4. Generate client; for SQLite, create the DB so the app runs immediately.
try {
  if (provider === "sqlite") {
    mkdirSync(join(root, "data"), { recursive: true });
    execSync("npx prisma db push", { cwd: root, stdio: "inherit" });
  } else {
    execSync("npx prisma generate", { cwd: root, stdio: "inherit" });
    console.log("[Campfire] Postgres detected — run `npm run db:migrate` (or db:push) once your DB is reachable.");
  }
} catch (err) {
  console.warn(
    "[Campfire] Prisma setup skipped — run `npm run db:push` after configuring .env.\n         " +
      (err && err.message ? err.message : err),
  );
}
