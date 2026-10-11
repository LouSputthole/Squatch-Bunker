#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
const desktopPackage = JSON.parse(readFileSync(join(projectRoot, "desktop", "package.json"), "utf8"));
const desktopLock = JSON.parse(readFileSync(join(projectRoot, "desktop", "package-lock.json"), "utf8"));
const builder = JSON.parse(
  readFileSync(join(projectRoot, "packaging", "electron-builder.json"), "utf8"),
);
const requireStage = process.argv.includes("--require-stage");
// After desktop:installer / desktop:dist: inspect the built app and the auto-update feed files.
const requirePackage = process.argv.includes("--require-package");

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
  "desktop/launcher-core.cjs",
  "desktop/package-lock.json",
  "packaging/stage-desktop.mjs",
  "packaging/verify-desktop.mjs",
  "public/Campfire-Icon.png",
  "LICENSE",
]) {
  assert(existsSync(join(projectRoot, sourcePath)), `Missing ${sourcePath}`);
}

for (const sourcePath of ["desktop/main.cjs", "desktop/database.cjs", "desktop/legacy-state.cjs", "desktop/launcher-core.cjs", "packaging/stage-desktop.mjs", "packaging/verify-desktop.mjs"]) {
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
assert(
  builder.files?.includes("launcher-core.cjs"),
  "Desktop launcher-core helpers must be packaged with the Electron main process",
);
assert(
  desktopLauncher.includes('CAMPFIRE_TELEMETRY: "off"'),
  "The bundled server must not ping on its own; the launcher already counts this install",
);
assert(typeof desktopPackage.campfireCloudUrl === "string", 'desktop/package.json needs a "campfireCloudUrl" string');

// Auto-update: electron-updater ships inside app.asar and reads the GitHub feed electron-builder
// bakes into resources/app-update.yml (desktop/main.cjs createAutoUpdater).
const updaterVersion = desktopPackage.dependencies?.["electron-updater"];
assert(/^\d+\.\d+\.\d+$/.test(updaterVersion ?? ""), "desktop/package.json must pin electron-updater to an exact version");
assert(
  desktopLock.packages?.["node_modules/electron-updater"]?.version === updaterVersion,
  "desktop/package-lock.json is out of date with desktop/package.json (run npm install in desktop/)",
);
assert(
  !builder.files?.some((pattern) => pattern.startsWith("!") && pattern.includes("node_modules")),
  "electron-builder files must not exclude node_modules: electron-updater ships in app.asar",
);
const updateFeed = Array.isArray(builder.publish) ? builder.publish[0] : builder.publish;
assert(updateFeed?.provider === "github", 'electron-builder "publish" must be the GitHub provider (it generates latest.yml)');
assert(
  desktopLauncher.includes(`const UPDATE_REPO = "${updateFeed.owner}/${updateFeed.repo}";`),
  "electron-builder publish owner/repo must match UPDATE_REPO in desktop/main.cjs",
);
assert(desktopLauncher.includes('require("electron-updater")'), "Desktop launcher must use electron-updater");
assert(
  desktopLauncher.includes('"x-user-staging-id": "00000000-0000-0000-0000-000000000000"'),
  "Desktop launcher must replace electron-updater's per-install id header (docs/TELEMETRY.md promises anonymous update checks)",
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
  const launcherConfigPath = join(stagedServerRoot, "desktop-launcher.json");
  assert(existsSync(launcherConfigPath), "Staged desktop-launcher.json (Campfire Online URL) is missing");
  const launcherConfig = JSON.parse(readFileSync(launcherConfigPath, "utf8"));
  assert(typeof launcherConfig.cloudUrl === "string", "Staged desktop-launcher.json needs a cloudUrl string");
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
  const installedUpdater = join(projectRoot, "desktop", "node_modules", "electron-updater", "package.json");
  assert(
    existsSync(installedUpdater) && JSON.parse(readFileSync(installedUpdater, "utf8")).version === updaterVersion,
    `desktop/node_modules must hold electron-updater ${updaterVersion} (desktop:stage installs it)`,
  );
}

const distRoot = join(projectRoot, "desktop", "dist");
const unpackedResources = join(distRoot, "win-unpacked", "resources");
const appAsar = join(unpackedResources, "app.asar");
let packagedCloudUrl = null;
if (requirePackage || existsSync(appAsar)) {
  assert(existsSync(appAsar), "Built app is missing (desktop/dist/win-unpacked/resources/app.asar); run desktop:installer");
  const packagedLauncherConfig = join(unpackedResources, "server", "desktop-launcher.json");
  if (existsSync(packagedLauncherConfig)) {
    packagedCloudUrl = JSON.parse(readFileSync(packagedLauncherConfig, "utf8")).cloudUrl;
  }
  // The release gate: installed copies auto-update to whatever is published, so a smoke build's
  // http://127.0.0.1 URL would strand every one of them. Without the flag a local smoke build still verifies.
  if (requirePackage) {
    assert(typeof packagedCloudUrl === "string", "Built app lacks resources/server/desktop-launcher.json; rebuild after desktop:stage");
    assert(
      packagedCloudUrl === "" || packagedCloudUrl.startsWith("https://"),
      `Built app has a non-HTTPS Campfire Online URL (${packagedCloudUrl}; smoke build?); rebuild with the real domain, or none`,
    );
  }
  const { listPackage } = createRequire(import.meta.url)("@electron/asar");
  const packagedModules = new Set(
    listPackage(appAsar, { isPack: false })
      .map((entry) => /\/node_modules\/((?:@[^/]+\/)?[^/]+)\/package\.json$/.exec(entry.replaceAll("\\", "/"))?.[1])
      .filter(Boolean),
  );
  const expectedModules = new Set(
    Object.entries(desktopLock.packages ?? {})
      .filter(([key, entry]) => key.startsWith("node_modules/") && !entry.dev && !entry.optional)
      .map(([key]) => key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length)),
  );
  for (const name of expectedModules) {
    assert(packagedModules.has(name), `Built app.asar is missing runtime dependency ${name}; rebuild after desktop:stage`);
  }
  for (const name of packagedModules) {
    // Catches electron-builder falling back to the web app's dependency tree.
    assert(expectedModules.has(name), `Built app.asar contains ${name}, which desktop/package-lock.json does not list`);
  }
  const installerName = `Campfire-Setup-${desktopPackage.version}-x64.exe`;
  if (requirePackage || existsSync(join(distRoot, installerName))) {
    for (const file of [installerName, `${installerName}.blockmap`, "latest.yml"]) {
      assert(existsSync(join(distRoot, file)), `Release asset desktop/dist/${file} is missing; auto-update needs all three`);
    }
    const latest = readFileSync(join(distRoot, "latest.yml"), "utf8");
    assert(
      latest.includes(`version: ${desktopPackage.version}`) && latest.includes(`path: ${installerName}`),
      `desktop/dist/latest.yml does not describe ${installerName}; it is from another build`,
    );
    const appUpdatePath = join(unpackedResources, "app-update.yml");
    assert(existsSync(appUpdatePath), "Built app lacks resources/app-update.yml; installed copies could not find updates");
    const appUpdate = readFileSync(appUpdatePath, "utf8");
    assert(
      /^provider: github$/m.test(appUpdate) &&
        appUpdate.includes(`owner: ${updateFeed.owner}`) &&
        appUpdate.includes(`repo: ${updateFeed.repo}`),
      "resources/app-update.yml does not point at the GitHub release feed",
    );
  }
}

console.log("[Campfire] Desktop packaging configuration verified.");
if (packagedCloudUrl !== null) {
  console.log(`[Campfire] Built app's Campfire Online URL: ${packagedCloudUrl || "(none: Host on this PC only)"}`);
}
