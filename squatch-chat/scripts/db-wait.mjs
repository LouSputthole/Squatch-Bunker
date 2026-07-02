#!/usr/bin/env node
/**
 * Campfire db:wait — cross-platform port of the old db-wait.sh.
 * Polls until Postgres is ready (via Docker exec, falling back to a local
 * pg_isready) or gives up after TRIES seconds.
 */
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const CONTAINER_NAME = "campfire-db";
const TRIES = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 30;

function commandExists(cmd) {
  const result = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return !result.error;
}

function succeeded(result) {
  return !result.error && result.status === 0;
}

async function pollUntilReady(cmd, args) {
  for (let i = 0; i < TRIES; i++) {
    if (succeeded(spawnSync(cmd, args, { stdio: "ignore" }))) {
      console.log("Postgres is ready.");
      return true;
    }
    await sleep(1000);
  }
  return false;
}

async function main() {
  // Try Docker container first
  if (commandExists("docker")) {
    if (await pollUntilReady("docker", ["exec", CONTAINER_NAME, "pg_isready", "-U", "postgres", "-d", "campfire"])) {
      return;
    }
  }

  // Try local pg_isready as fallback
  if (commandExists("pg_isready")) {
    if (await pollUntilReady("pg_isready", ["-h", "127.0.0.1", "-p", "5432"])) {
      return;
    }
  }

  console.error(`Error: Postgres did not become ready in ${TRIES}s.`);
  process.exit(1);
}

main();
