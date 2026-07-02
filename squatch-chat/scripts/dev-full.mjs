#!/usr/bin/env node
/**
 * Campfire dev:full — cross-platform port of the old dev-full.sh.
 * Runs setup.sh (Docker/Postgres bootstrap — still bash, left as-is), then
 * starts the realtime server and Next.js dev server together until Ctrl+C.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Run setup (idempotent — skips what's already done)
const setup = spawnSync("bash", ["scripts/setup.sh"], { cwd: root, stdio: "inherit" });
if (setup.status !== 0) process.exit(setup.status ?? 1);

console.log("");
console.log("  Starting Campfire...");
console.log("");

const isWindows = process.platform === "win32";
const spawnOpts = { cwd: root, stdio: "inherit", shell: isWindows };

// Start realtime server in background
const realtime = spawn("pnpm", ["dev:realtime"], spawnOpts);

// Start Next.js
const next = spawn("pnpm", ["dev"], spawnOpts);

console.log("");
console.log("  Campfire is running!");
console.log("  -> App:      http://localhost:3000");
console.log("  -> Realtime: ws://localhost:3001");
console.log("");
console.log("  Press Ctrl+C to stop");
console.log("");

let shuttingDown = false;
function shutdown(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("");
  console.log("  Shutting down...");
  realtime.kill();
  next.kill();
  console.log("  Campfire stopped.");
  process.exit(exitCode ?? 0);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
realtime.on("exit", (code) => shutdown(code ?? 0));
next.on("exit", (code) => shutdown(code ?? 0));
