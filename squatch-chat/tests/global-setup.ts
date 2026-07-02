import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { TEST_DB_DIR, TEST_DB_FILE, TEST_DB_URL } from "./db-path";

const SIDECARS = ["", "-journal", "-wal", "-shm"];

function removeDbFiles() {
  for (const suffix of SIDECARS) {
    const f = TEST_DB_FILE + suffix;
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

// Builds a fresh schema on the throwaway SQLite file once, before the suite
// runs. Executes in the Vitest main process, so it shells out to prisma rather
// than touching the app's Prisma singleton.
export default function setup() {
  mkdirSync(TEST_DB_DIR, { recursive: true });
  removeDbFiles();
  // DATABASE_URL is passed via env (never interpolated into the command) so the
  // temp DB path can't influence the shell. Mirrors the app's postinstall push.
  execSync("npx prisma db push --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
  });
  return removeDbFiles;
}
