#!/usr/bin/env node
/**
 * Campfire db:up — cross-platform port of the old db-up.sh.
 * Starts (or creates) the campfire-db Postgres container via Docker.
 */
import { spawnSync } from "node:child_process";

const CONTAINER_NAME = "campfire-db";
const VOLUME_NAME = "campfire-data";
const IMAGE = "postgres:16-alpine";

function commandExists(cmd) {
  const result = spawnSync(cmd, ["--version"], { stdio: "ignore" });
  return !result.error;
}

function containerNames(all) {
  const args = all ? ["ps", "-a", "--format", "{{.Names}}"] : ["ps", "--format", "{{.Names}}"];
  const result = spawnSync("docker", args, { encoding: "utf8" });
  return (result.stdout || "").split("\n").map((line) => line.trim()).filter(Boolean);
}

if (!commandExists("docker")) {
  console.error("Error: Docker is not installed.");
  console.error("");
  console.error("Install Docker from: https://docs.docker.com/get-docker/");
  console.error("  - Windows/Mac: Docker Desktop");
  console.error("  - Linux: sudo apt install docker.io  or  sudo dnf install docker");
  process.exit(1);
}

// Already running
if (containerNames(false).includes(CONTAINER_NAME)) {
  console.log("Postgres already running.");
  process.exit(0);
}

// Exists but stopped
if (containerNames(true).includes(CONTAINER_NAME)) {
  console.log("Starting existing Postgres container...");
  const start = spawnSync("docker", ["start", CONTAINER_NAME], { stdio: ["ignore", "ignore", "inherit"] });
  if (start.status !== 0) process.exit(start.status ?? 1);
  console.log("Postgres container started.");
  process.exit(0);
}

// Create fresh
console.log("Creating Postgres container...");
spawnSync("docker", ["volume", "create", VOLUME_NAME], { stdio: "ignore" });

const run = spawnSync(
  "docker",
  [
    "run",
    "-d",
    "--name",
    CONTAINER_NAME,
    "--restart",
    "unless-stopped",
    "-e",
    "POSTGRES_USER=postgres",
    "-e",
    "POSTGRES_PASSWORD=postgres",
    "-e",
    "POSTGRES_DB=campfire",
    "-p",
    "5432:5432",
    "-v",
    `${VOLUME_NAME}:/var/lib/postgresql/data`,
    IMAGE,
  ],
  { stdio: ["ignore", "ignore", "inherit"] },
);
if (run.status !== 0) process.exit(run.status ?? 1);

console.log("Postgres container started.");
