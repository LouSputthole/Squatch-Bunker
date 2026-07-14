#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const desktopPackage = JSON.parse(readFileSync(join(projectRoot, "desktop", "package.json"), "utf8"));
const builder = JSON.parse(
  readFileSync(join(projectRoot, "packaging", "electron-builder.json"), "utf8"),
);
const requireStage = process.argv.includes("--require-stage");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(rootPackage.version === desktopPackage.version, "Desktop and web versions differ");
assert(desktopPackage.main === "main.cjs", "Desktop entry point must be main.cjs");
assert(builder.appId === "com.squatchbunker.campfire", "Unexpected Windows application ID");
assert(builder.win?.signAndEditExecutable === true, "Windows signing/editing must remain enabled");
assert(builder.nsis?.perMachine === false, "Installer must remain a per-user install");

const targets = new Set((builder.win?.target ?? []).map((entry) => entry.target));
assert(targets.has("portable"), "Portable target is missing");
assert(targets.has("nsis"), "NSIS target is missing");

const dependencyResource = builder.extraResources?.find(
  (resource) => resource.from === "desktop/.stage/server/node_modules",
);
assert(
  dependencyResource?.to === "server/node_modules",
  "Staged server dependencies must be copied explicitly; electron-builder otherwise drops node_modules",
);

const licenseResource = builder.extraResources?.find(
  (resource) => resource.from === "LICENSE",
);
assert(
  licenseResource?.to === "LICENSE.campfire.txt",
  "Portable and installer artifacts must include Campfire's AGPL license",
);

for (const script of ["desktop:stage", "desktop:verify", "desktop:portable", "desktop:installer", "desktop:dist"]) {
  assert(typeof rootPackage.scripts?.[script] === "string", `Missing npm script ${script}`);
}
for (const dependency of ["@electron/rebuild", "electron", "electron-builder", "esbuild"]) {
  assert(typeof rootPackage.devDependencies?.[dependency] === "string", `Missing ${dependency}`);
}
for (const sourcePath of [
  "desktop/main.cjs",
  "desktop/database.cjs",
  "desktop/legacy-state.cjs",
  "desktop/package-lock.json",
  "packaging/stage-desktop.mjs",
  "packaging/verify-desktop.mjs",
  "public/Campfire-Icon.png",
  "LICENSE",
]) {
  assert(existsSync(join(projectRoot, sourcePath)), `Missing ${sourcePath}`);
}

for (const sourcePath of ["desktop/main.cjs", "desktop/database.cjs", "desktop/legacy-state.cjs", "packaging/stage-desktop.mjs", "packaging/verify-desktop.mjs"]) {
  const result = spawnSync(process.execPath, ["--check", join(projectRoot, sourcePath)], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  assert(result.status === 0, `Syntax check failed for ${sourcePath}`);
}

const desktopLauncher = readFileSync(join(projectRoot, "desktop", "main.cjs"), "utf8");
assert(
  desktopLauncher.includes("required-server-files.json") &&
    desktopLauncher.includes("__NEXT_PRIVATE_STANDALONE_CONFIG"),
  "Desktop launcher must reuse the built standalone config to prevent runtime SWC downloads",
);
assert(
  desktopLauncher.includes("upgradeDesktopDatabase"),
  "Desktop launcher must upgrade existing per-user databases before server startup",
);
assert(
  desktopLauncher.includes("CAMPFIRE_UPLOAD_DIR"),
  "Desktop launcher must store uploads and avatars under the per-user data directory",
);
assert(
  desktopLauncher.includes("importLegacyDesktopState"),
  "Desktop launcher must import v0.0.3 state before creating beta state",
);
assert(
  builder.files?.includes("database.cjs"),
  "Desktop database upgrader must be packaged with the Electron main process",
);

assert(
  builder.files?.includes("legacy-state.cjs"),
  "Desktop legacy-state importer must be packaged with the Electron main process",
);
const stagedServerRoot = join(projectRoot, "desktop", ".stage", "server");
if (requireStage || existsSync(stagedServerRoot)) {
  const bootstrapPath = join(stagedServerRoot, "campfire-server.mjs");
  const bundlePath = join(stagedServerRoot, "campfire-server.bundle.mjs");
  const headersShimPath = join(stagedServerRoot, "node_modules", "next", "headers.js");
  const webpackRuntimePath = join(
    stagedServerRoot,
    "node_modules",
    "next",
    "dist",
    "compiled",
    "webpack",
    "webpack-lib.js",
  );
  const babelRuntimePath = join(
    stagedServerRoot,
    "node_modules",
    "next",
    "dist",
    "compiled",
    "@babel",
    "runtime",
    "package.json",
  );
  const sqliteNativePath = join(
    stagedServerRoot,
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node",
  );
  assert(existsSync(bootstrapPath), "Staged desktop server bootstrap is missing");
  assert(existsSync(bundlePath), "Staged desktop server bundle is missing");
  assert(existsSync(headersShimPath), "Staged next/headers.js compatibility shim is missing");
  assert(existsSync(webpackRuntimePath), "Staged Next compiled webpack runtime is missing");
  assert(existsSync(babelRuntimePath), "Staged Next compiled Babel runtime is missing");
  assert(existsSync(sqliteNativePath), "Staged Electron-native better-sqlite3 binary is missing");
  for (const buildOnlyPath of [
    join(stagedServerRoot, "node_modules", "better-sqlite3", "binding.gyp"),
    join(stagedServerRoot, "node_modules", "better-sqlite3", "deps"),
    join(stagedServerRoot, "node_modules", "better-sqlite3", "src"),
    join(stagedServerRoot, "node_modules", "better-sqlite3", "bin"),
    join(stagedServerRoot, "node_modules", "better-sqlite3", "build", "Release", "obj"),
  ]) {
    assert(!existsSync(buildOnlyPath), `Staged native compiler artifact was not pruned: ${buildOnlyPath}`);
  }
  const bundle = readFileSync(bundlePath, "utf8");
  assert(!/["']next\/headers["']/.test(bundle), "Staged bundle still imports extensionless next/headers");
  assert(/["']next\/headers\.js["']/.test(bundle), "Staged bundle does not import next/headers.js");
  assert(bundle.includes("__campfireCreateRequire"), "Staged ESM bundle lacks its Node require bridge");
  const bootstrap = readFileSync(bootstrapPath, "utf8");
  assert(bootstrap.includes("globalThis.AsyncLocalStorage"), "Staged bootstrap does not install AsyncLocalStorage");
  assert(bootstrap.includes('await import("./campfire-server.bundle.mjs")'), "Staged bootstrap does not defer the server bundle");
}

console.log("[Campfire] Desktop packaging configuration verified.");
