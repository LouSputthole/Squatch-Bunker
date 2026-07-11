/**
 * Campfire desktop server entry.
 *
 * A single-port Next.js + Socket.IO server, bundled by esbuild into one
 * `server-desktop.js` that is dropped into the Next `standalone` tree so its
 * `require()`s (next, react, @prisma/client, better-sqlite3) resolve from the
 * traced `node_modules` there.
 *
 * It is spawned by the Electron main process using Electron's embedded Node
 * (ELECTRON_RUN_AS_NODE=1), so no system Node install is required. All runtime
 * configuration arrives via env from main.js:
 *   PORT                    dynamically-chosen free port
 *   DATABASE_URL            absolute file: URL into the data dir
 *   JWT_SECRET              per-install server secret
 *   CAMPFIRE_UPLOAD_DIR     writable dir for /uploads + /avatars
 *   CAMPFIRE_MIGRATIONS_DIR dir of SQLite migration folders
 */
import "@/lib/als-polyfill"; // must precede `next` — see file comment
import { createServer } from "node:http";
import { parse } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import next from "next";
import { attachSocketIO } from "@/realtime/server";
import { runMigrations } from "./migrate";
import { makeStaticHandler } from "./static-serve";

const dir = process.cwd(); // main.js sets cwd to the standalone tree root
const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = "127.0.0.1";

function loadNextConfig(): Record<string, unknown> {
  // The standalone build embeds the fully-resolved next config here; reuse it so
  // we don't need a next.config file (or the build toolchain) at runtime.
  const rsf = JSON.parse(
    readFileSync(join(dir, ".next", "required-server-files.json"), "utf8"),
  );
  return rsf.config;
}

// Self-terminate if the Electron main process dies (crash / force-kill) so the
// server is never orphaned. Normal quit is handled by main.js killing us; this
// covers the cases where before-quit never runs.
function watchParent() {
  const parentPid = parseInt(process.env.CAMPFIRE_PARENT_PID || "0", 10);
  if (!parentPid) return;
  setInterval(() => {
    try {
      process.kill(parentPid, 0); // signal 0 = existence check
    } catch {
      process.exit(0);
    }
  }, 3000).unref();
}

async function main() {
  watchParent();

  // 1. Apply pending SQLite migrations BEFORE anything touches Prisma.
  const dbUrl = process.env.DATABASE_URL || "";
  const migrationsDir = process.env.CAMPFIRE_MIGRATIONS_DIR;
  if (dbUrl.startsWith("file:") && migrationsDir) {
    runMigrations(dbUrl.replace(/^file:/, ""), migrationsDir);
  }

  // 2. Prepare Next against the standalone build output.
  const conf = loadNextConfig();
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(conf);

  const app = next({ dev: false, dir, conf, hostname: HOST, port: PORT });
  const handle = app.getRequestHandler();
  await app.prepare();

  // 3. Serve user uploads from the writable data dir (app folder is read-only
  //    when installed), falling through to Next for everything else.
  const uploadDir = process.env.CAMPFIRE_UPLOAD_DIR;
  const serveStatic = uploadDir ? makeStaticHandler(uploadDir) : null;

  const httpServer = createServer((req, res) => {
    if (serveStatic && serveStatic(req, res)) return;
    handle(req, res, parse(req.url || "/", true));
  });

  // 4. Socket.IO shares the same HTTP server → single port.
  attachSocketIO(httpServer);

  httpServer.listen(PORT, HOST, () => {
    console.log(`[Campfire] Desktop server listening on http://${HOST}:${PORT}`);
  });
}

main().catch((err) => {
  console.error("[Campfire] Failed to start:", err);
  process.exit(1);
});
