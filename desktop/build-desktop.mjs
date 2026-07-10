#!/usr/bin/env node
/**
 * Campfire desktop build — full chain, Windows x64.
 *
 *   web build (sqlite, single-port)  →  esbuild server bundle into the
 *   standalone tree  →  rebuild better-sqlite3 for Electron  →  electron-builder
 *   (dir + nsis)  →  assemble the portable folder (+ portable.txt + README.txt)
 *   and zip it; the nsis installer is produced alongside.
 *
 * Usage:
 *   node build-desktop.mjs              # portable folder + installer
 *   node build-desktop.mjs --portable   # portable folder + zip only
 *   node build-desktop.mjs --installer  # nsis installer only
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  renameSync,
  mkdirSync,
  statSync,
  readdirSync,
  copyFileSync,
  lstatSync,
  realpathSync,
  cpSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const DESKTOP = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DESKTOP, "..");
const SQUATCH = join(ROOT, "squatch-chat");
const STANDALONE = join(SQUATCH, ".next", "standalone");
const DIST = join(DESKTOP, "dist");
const ARCH = "x64";

const args = process.argv.slice(2);
const only = args.includes("--portable") ? "portable" : args.includes("--installer") ? "installer" : "both";
const doPortable = only === "portable" || only === "both";
const doInstaller = only === "installer" || only === "both";

const version = JSON.parse(readFileSync(join(SQUATCH, "package.json"), "utf8")).version;

function step(msg) {
  console.log(`\n\x1b[1m\x1b[38;5;208m▲ [build-desktop] ${msg}\x1b[0m`);
}
function run(cmd, cmdArgs, opts = {}) {
  console.log(`  $ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { stdio: "inherit", shell: process.platform === "win32", ...opts });
}

// ─── 1. Web build (sqlite provider, single-port: no NEXT_PUBLIC_* baked in) ───
function webBuild() {
  step("Building the Campfire web app (sqlite, single-port)");
  run("node", ["scripts/build.mjs"], {
    cwd: SQUATCH,
    env: {
      ...process.env,
      DB_PROVIDER: "sqlite",
      DATABASE_URL: "file:./data/campfire.db",
      // Force single-port: empty so nothing gets inlined into the client bundle.
      NEXT_PUBLIC_SOCKET_URL: "",
      NEXT_PUBLIC_APP_URL: "",
      NEXT_PUBLIC_SOCKET_PATH: "",
    },
  });
  if (!existsSync(join(STANDALONE, "server.js"))) {
    throw new Error("Standalone build missing — expected .next/standalone/server.js");
  }
}

// ─── 2. esbuild: bundle the desktop server entry into the standalone tree ───
async function bundleServer() {
  step("Bundling server-desktop.js with esbuild");
  const esbuild = require("esbuild");
  const outfile = join(STANDALONE, "server-desktop.js");
  await esbuild.build({
    entryPoints: [join(DESKTOP, "src", "server-desktop.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    outfile,
    absWorkingDir: SQUATCH,
    // next/headers → local stub: it's only reached via lib/auth's getSession,
    // which the realtime layer never calls, and it doesn't resolve through the
    // standalone require-hook under Electron.
    alias: { "@": SQUATCH, "next/headers": join(DESKTOP, "src", "shims", "next-headers.ts") },
    // Resolve from the standalone node_modules at runtime; everything else
    // (socket.io, jsonwebtoken, the generated prisma client, the sqlite adapter)
    // is bundled in.
    external: ["next", "react", "react-dom", "@prisma/client", "better-sqlite3", "@prisma/adapter-pg", "pg"],
    banner: {
      js: 'const __IMPORT_META_URL__ = require("url").pathToFileURL(require("path").join(__dirname, "campfire-desktop-meta.mjs")).href;',
    },
    define: { "import.meta.url": "__IMPORT_META_URL__" },
    logLevel: "info",
  });
  if (!existsSync(outfile)) throw new Error("esbuild did not produce server-desktop.js");
}

// ─── 3. Swap better-sqlite3 for Electron's ABI (inside the standalone tree) ────
// `next build` re-copies the Node-ABI binary from source into the standalone
// tree every time, so this MUST run after webBuild. prebuild-install fetches the
// Electron-ABI prebuilt binary (no C++ toolchain needed); @electron/rebuild is a
// compile-from-source fallback.
async function rebuildNative() {
  step("Fetching better-sqlite3 for Electron's ABI");
  const electronVersion = require("electron/package.json").version;
  const moduleDir = join(STANDALONE, "node_modules", "better-sqlite3");
  try {
    run("npx", ["prebuild-install", "-r", "electron", "-t", electronVersion, "--arch", ARCH], { cwd: moduleDir });
  } catch (err) {
    console.warn(`  prebuild-install failed (${err.message}); trying @electron/rebuild…`);
    const { rebuild } = require("@electron/rebuild");
    await rebuild({ buildPath: STANDALONE, electronVersion, arch: ARCH, onlyModules: ["better-sqlite3"], force: true });
  }

  materializeBundledModules(moduleDir);

  // Next copies better-sqlite3 into .next/node_modules/better-sqlite3-<hash>/ and
  // the compiled server actually loads THAT copy — so every better_sqlite3.node
  // in the tree must be the Electron-ABI binary, not just the top-level module.
  const good = join(moduleDir, "build", "Release", "better_sqlite3.node");
  const copies = findFiles(STANDALONE, "better_sqlite3.node");
  for (const c of copies) {
    if (c !== good) {
      copyFileSync(good, c);
      console.log(`  patched ${relative(STANDALONE, c)}`);
    }
  }
  verifyNativeUnderElectron(electronVersion, copies);
}

// Next symlinks/junctions .next/node_modules/<pkg>-<hash> to the SOURCE
// node_modules (which holds the Node-ABI better-sqlite3 and won't survive
// packaging). Replace each junction with a real copy — better-sqlite3 from our
// Electron-ABI module, everything else (prisma client, pg — all JS/wasm) from
// the junction's own target.
function materializeBundledModules(electronSqliteDir) {
  const bundledDir = join(STANDALONE, ".next", "node_modules");
  if (!existsSync(bundledDir)) return;
  step("Materializing Next's bundled node_modules (dereferencing junctions)");

  const materialize = (linkPath) => {
    if (!lstatSync(linkPath).isSymbolicLink()) return;
    const isSqlite = /better-sqlite3/.test(linkPath);
    const src = isSqlite ? electronSqliteDir : realpathSync(linkPath);
    rmSync(linkPath, { recursive: true, force: true }); // removes only the junction
    cpSync(src, linkPath, { recursive: true, dereference: true });
    console.log(`  materialized ${relative(STANDALONE, linkPath)}${isSqlite ? " (Electron ABI)" : ""}`);
  };

  for (const name of readdirSync(bundledDir)) {
    const p = join(bundledDir, name);
    if (name.startsWith("@")) {
      for (const sub of readdirSync(p)) materialize(join(p, sub));
    } else {
      materialize(p);
    }
  }
}

function findFiles(dir, name, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) findFiles(p, name, out);
    else if (entry.name === name) out.push(p);
  }
  return out;
}

// dlopen every better_sqlite3.node copy under Electron — an ABI mismatch throws.
function verifyNativeUnderElectron(electronVersion, copies) {
  step(`Verifying ${copies.length} better-sqlite3 binary(ies) load under Electron`);
  const electron = require("electron"); // path to electron.exe
  for (const nodePath of copies) {
    execFileSync(
      electron,
      ["-e", `const m={exports:{}};process.dlopen(m,${JSON.stringify(nodePath)});console.log("DLOPEN_OK");`],
      { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
    );
    console.log(`  ok ${relative(STANDALONE, nodePath)}`);
  }
  console.log(`  better-sqlite3 verified for Electron ${electronVersion}`);
}

// ─── 3b. Strip dev-only files Next copied into the standalone tree ───
// (electron-builder ships the standalone dir verbatim, incl. node_modules, so we
// remove what must never ship rather than relying on copy filters.)
function cleanStandalone() {
  step("Cleaning dev-only files from the standalone tree");
  for (const rel of [".env", ".env.local", ".env.production", "data"]) {
    const p = join(STANDALONE, rel);
    if (existsSync(p)) {
      rmSync(p, { recursive: true, force: true });
      console.log(`  removed ${rel}`);
    }
  }
}

// ─── 4. electron-builder ───
function packageApp() {
  const targets = only === "portable" ? ["dir"] : only === "installer" ? ["nsis"] : [];
  step(`Packaging with electron-builder (${targets.length ? targets.join("+") : "dir+nsis"})`);
  run("npx", [
    "electron-builder",
    "--win",
    ...targets,
    `--config.extraMetadata.version=${version}`,
  ], { cwd: DESKTOP });
}

// ─── 5. Assemble the portable folder ───
function assemblePortable() {
  step("Assembling the portable folder");
  const unpacked = join(DIST, "win-unpacked");
  const folder = join(DIST, "Campfire");
  if (!existsSync(unpacked)) throw new Error(`Expected ${unpacked} from the dir target`);
  if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
  renameSync(unpacked, folder);

  // portable.txt marks the folder as portable → data lives in .\data next to the
  // exe. (The nsis installer must NOT contain this file; it uses userData.)
  writeFileSync(join(folder, "portable.txt"), PORTABLE_MARKER);
  // BOM so pre-1903 Notepad and non-UTF8-locale editors render the em-dashes.
  writeFileSync(join(folder, "README.txt"), "﻿" + README_TXT);

  const zip = join(DIST, `Campfire-Portable-Windows-${ARCH}.zip`);
  if (existsSync(zip)) rmSync(zip);
  step("Zipping the portable folder");
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `Compress-Archive -Path '${folder}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal`],
    { stdio: "inherit" },
  );
  return { folder, zip };
}

const PORTABLE_MARKER = `Campfire portable marker — do not delete.
When this file sits next to Campfire.exe, Campfire stores all of its data in
the "data" folder beside the exe (database, settings, uploads, logs), so the
whole folder is self-contained and movable.
`;

const README_TXT = `Campfire — portable edition (Windows x64)
==========================================

WHAT THIS IS
  A self-hosted, Discord-style voice & text chat app. Everything runs locally
  on this PC. No installation and no Node.js are required.

HOW TO LAUNCH
  1. Keep this whole folder together (do not move Campfire.exe out on its own).
  2. Double-click Campfire.exe.
  3. The first launch creates your database and a login page opens in the app.

WHERE YOUR DATA LIVES
  Right here, in the "data" folder next to Campfire.exe:
    data\\campfire.db      your servers, channels and messages
    data\\secret           this install's server signing key
    data\\settings.json    window size + tray preference
    data\\uploads, avatars files people upload
    data\\logs             server logs (useful if something breaks)

MOVING IT / USING A USB STICK
  Copy the entire Campfire folder (including the "data" folder) anywhere —
  another drive, a USB stick, another PC. Your account and messages come along.

UPDATING
  Download the new Campfire folder, then copy your existing "data" folder into
  it (replacing the empty one). Your data stays; only the app files change.

SHARING WITH FRIENDS ON YOUR NETWORK
  Campfire listens locally. To let others on your Wi-Fi/LAN connect, use the
  self-hosted server build (see the project README) — the desktop app is meant
  for running Campfire on this machine.

TRAY / CLOSING
  Closing the window keeps Campfire running in the system tray by default.
  Right-click the tray icon to quit fully, or to make the X button quit.

PROBLEMS?
  Check data\\logs\\server.log, then open an issue with what you see:
  https://github.com/LouSputthole/Squatch-Bunker/issues
`;

async function main() {
  console.log(`Campfire desktop build — v${version} — mode: ${only}`);
  webBuild();
  await bundleServer();
  await rebuildNative();
  cleanStandalone();
  packageApp();

  const artifacts = [];
  if (doPortable) {
    const { folder, zip } = assemblePortable();
    artifacts.push(folder, zip);
  }
  if (doInstaller) {
    const installer = join(DIST, `Campfire-Setup-${version}-${ARCH}.exe`);
    if (existsSync(installer)) artifacts.push(installer);
  }

  step("Done");
  for (const a of artifacts) {
    const size = existsSync(a) ? (statSync(a).isFile() ? `${(statSync(a).size / 1e6).toFixed(1)} MB` : "folder") : "MISSING";
    console.log(`  ${a}  (${size})`);
  }
}

main().catch((err) => {
  console.error("\n[build-desktop] FAILED:", err.message);
  process.exit(1);
});
