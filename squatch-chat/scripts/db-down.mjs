#!/usr/bin/env node
/**
 * Campfire db:down — cross-platform port of the old db-down.sh.
 * Stops the campfire-db Postgres container.
 */
import { spawnSync } from "node:child_process";

const CONTAINER_NAME = "campfire-db";

function commandExists(cmd) {
  const result = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return !result.error;
}

if (!commandExists("docker")) {
  console.error("Error: Docker is not installed.");
  process.exit(1);
}

const ps = spawnSync("docker", ["ps", "--format", "{{.Names}}"], { encoding: "utf8" });
const names = (ps.stdout || "").split("\n").map((line) => line.trim()).filter(Boolean);

if (names.includes(CONTAINER_NAME)) {
  const stop = spawnSync("docker", ["stop", CONTAINER_NAME], { stdio: ["ignore", "ignore", "inherit"] });
  if (stop.status !== 0) process.exit(stop.status ?? 1);
  console.log("Postgres container stopped.");
  process.exit(0);
}

console.log("Postgres container is not running.");
