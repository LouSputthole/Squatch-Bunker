#!/usr/bin/env node

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = join(root, ".env");
const generateOnly = process.env.CAMPFIRE_POSTINSTALL_GENERATE_ONLY === "1";

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit code ${result.status}`);
  }
}

function readEnvVar(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(envPath)) return "";
  const match = readFileSync(envPath, "utf8").match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
}

if (!generateOnly && !existsSync(envPath) && !process.env.DATABASE_URL) {
  const secret = randomBytes(32).toString("hex");
  writeFileSync(
    envPath,
    [
      "# Auto-generated for local / self-host (SQLite, zero-config).",
      "# For hosted PostgreSQL, set DATABASE_URL before installing.",
      'CAMPFIRE_EDITION="community"',
      'DATABASE_URL="file:./data/campfire.db"',
      `JWT_SECRET="${secret}"`,
      "SOCKET_PORT=3001",
      "",
    ].join("\n"),
  );
  console.log("[Campfire] Created .env with SQLite self-host defaults.");
}

// Client generation is mandatory: both server providers are compiled separately.
runNode(join(root, "scripts", "generate-prisma.mjs"));

if (generateOnly) {
  console.log("[Campfire] Postinstall generation-only mode complete.");
} else {
  const databaseUrl = readEnvVar("DATABASE_URL");
  if (!databaseUrl || databaseUrl.startsWith("file:")) {
    mkdirSync(join(root, "data"), { recursive: true });
    runNode(join(root, "scripts", "sync-sqlite.mjs"));
  } else {
    console.log(
      "[Campfire] PostgreSQL detected. Run `npm run db:migrate` when the database is reachable.",
    );
  }
}
