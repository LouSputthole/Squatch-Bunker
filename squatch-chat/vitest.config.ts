import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Resolve the "@/…" path alias the app uses (see tsconfig.json paths) so tests
// can import app modules exactly the way source does.
const rootDir = fileURLToPath(new URL(".", import.meta.url)).replace(/[\\/]+$/, "");

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\/(.*)/, replacement: `${rootDir}/$1` }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // setup runs env before app modules import (lib/config throws at import
    // without JWT_SECRET); global-setup builds the throwaway SQLite schema once.
    setupFiles: ["./tests/setup.ts"],
    globalSetup: ["./tests/global-setup.ts"],
    // Files share one SQLite file; run them sequentially to avoid write locks.
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 20000,
  },
});
