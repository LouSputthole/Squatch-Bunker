import { join } from "node:path";

// A single throwaway SQLite database for the whole test run. `prisma db push`
// and the better-sqlite3 adapter both resolve the relative `file:./…` form
// against the repo root (the cwd for `npm test`); the absolute paths are used
// for create/cleanup of the file itself.
export const TEST_DB_RELATIVE = "./tests/.tmp/test.db";
export const TEST_DB_URL = `file:${TEST_DB_RELATIVE}`;
export const TEST_DB_DIR = join(process.cwd(), "tests", ".tmp");
export const TEST_DB_FILE = join(TEST_DB_DIR, "test.db");
