#!/usr/bin/env node
// `npm run host:prod`: run your own Campfire for real. Builds once when there
// is no production build (or package.json changed since it), then starts the
// unified server with NODE_ENV=production: faster and quieter than
// `npm run host` (the development server), and it sends the anonymous usage
// ping (docs/TELEMETRY.md). Same runtime as the Docker image: tsx server.ts.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ponytail: package.json changes with every release, so this catches updates
 * between versions; after pulling unreleased commits run `npm run build`.
 */
export function needsBuild(dir = root) {
  const buildId = join(dir, ".next", "BUILD_ID");
  if (!existsSync(buildId)) return true;
  return statSync(join(dir, "package.json")).mtimeMs > statSync(buildId).mtimeMs;
}

/**
 * Production env for the server. A plain-HTTP host (no https://
 * NEXT_PUBLIC_APP_URL) gets COOKIE_SECURE=0 like the Windows app's LAN mode:
 * browsers drop Secure cookies on http://192.168.x.x, so nobody could sign in.
 * An explicit COOKIE_SECURE in the environment or .env always wins.
 */
export function productionEnv(env, fileEnv = {}) {
  const setting = (name) => env[name] || fileEnv[name] || "";
  const result = { ...env, NODE_ENV: "production" };
  if (!setting("COOKIE_SECURE") && !setting("NEXT_PUBLIC_APP_URL").startsWith("https://")) {
    result.COOKIE_SECURE = "0";
  }
  return result;
}

function main() {
  if (needsBuild()) {
    console.log("[Campfire] Building the production app (first start or after an update)...");
    const build = spawnSync(process.execPath, [join(root, "scripts", "build.mjs")], {
      cwd: root,
      stdio: "inherit",
    });
    if (build.status !== 0) process.exit(build.status ?? 1);
  }

  const envFile = join(root, ".env");
  const env = productionEnv(process.env, existsSync(envFile) ? parse(readFileSync(envFile)) : {});
  if (env.COOKIE_SECURE === "0" && process.env.COOKIE_SECURE !== "0") {
    console.log("[Campfire] Plain-HTTP hosting: session cookies without the Secure flag. "
      + "Behind HTTPS, set NEXT_PUBLIC_APP_URL=https://... in .env.");
  }

  const tsx = createRequire(import.meta.url).resolve("tsx/cli");
  const server = spawn(process.execPath, [tsx, "server.ts"], { cwd: root, env, stdio: "inherit" });
  // Ctrl+C already reaches the server through the terminal; a service manager's
  // SIGTERM to this launcher is passed on so the server drains cleanly.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => server.kill("SIGTERM"));
  server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
