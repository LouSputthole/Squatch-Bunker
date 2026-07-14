#!/usr/bin/env node

import { rebuild } from "@electron/rebuild";
import { build } from "esbuild";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { DESKTOP_SCHEMA_VERSION } = require("../desktop/database.cjs");

const packagingDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(packagingDirectory, "..");
const desktopRoot = join(projectRoot, "desktop");
const stageRoot = join(desktopRoot, ".stage", "server");
const schemaPath = join(projectRoot, "prisma", "schema.prisma");
const buildScript = join(projectRoot, "scripts", "build.mjs");
const prismaCli = join(projectRoot, "node_modules", "prisma", "build", "index.js");
const skipNextBuild = process.argv.includes("--skip-next-build");

function assertInside(parent, child) {
  const pathFromParent = relative(resolve(parent), resolve(child));
  if (pathFromParent.startsWith("..") || pathFromParent === "" || pathFromParent.includes(`..${sep}`)) {
    throw new Error(`Refusing to operate outside ${parent}: ${child}`);
  }
}

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
  }
}

function collectStandaloneRoots(directory, results = []) {
  if (existsSync(join(directory, "server.js")) && existsSync(join(directory, ".next"))) {
    results.push(directory);
    return results;
  }
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name === "node_modules") continue;
    const child = join(directory, entry.name);
    if (existsSync(join(child, "server.js")) && existsSync(join(child, ".next"))) {
      results.push(child);
      continue;
    }
    collectStandaloneRoots(child, results);
  }
  return results;
}

function createDatabaseTemplate() {
  const databasePath = join(stageRoot, "campfire-template.db");
  rmSync(databasePath, { force: true });

  const originalSchema = readFileSync(schemaPath, "utf8");
  const sqliteSchema = originalSchema.replace(
    /provider = "(?:sqlite|postgresql)"/,
    'provider = "sqlite"',
  );
  if (!sqliteSchema.includes('provider = "sqlite"')) {
    throw new Error("Could not select the SQLite Prisma provider for desktop staging");
  }

  try {
    if (sqliteSchema !== originalSchema) writeFileSync(schemaPath, sqliteSchema);
    run(
      process.execPath,
      [prismaCli, "db", "push"],
      {
        ...process.env,
        DB_PROVIDER: "sqlite",
        DATABASE_URL: `file:${databasePath.replaceAll("\\", "/")}`,
      },
    );
  } finally {
    if (sqliteSchema !== originalSchema) writeFileSync(schemaPath, originalSchema);
  }

  const database = new Database(databasePath);
  try {
    database.pragma(`user_version = ${DESKTOP_SCHEMA_VERSION}`);
  } finally {
    database.close();
  }
}

function directRunGuardPlugin() {
  return {
    name: "disable-realtime-direct-run",
    setup(context) {
      context.onLoad({ filter: /realtime[\\/]server\.ts$/ }, (args) => {
        const source = readFileSync(args.path, "utf8");
        const guarded = source.replace(
          /const isDirectRun = [^\r\n]+;/,
          "const isDirectRun = false;",
        );
        if (guarded === source) {
          throw new Error("Could not disable realtime standalone mode in the desktop bundle");
        }
        return { contents: guarded, loader: "ts", resolveDir: dirname(args.path) };
      });
    },
  };
}

async function main() {
  const nodeVersion = process.versions.node.split(".").map(Number);
  if (nodeVersion[0] < 22 || (nodeVersion[0] === 22 && nodeVersion[1] < 12)) {
    throw new Error("Desktop packaging requires Node.js 22.12.0 or newer");
  }

  const rootPackage = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
  const desktopPackage = JSON.parse(readFileSync(join(desktopRoot, "package.json"), "utf8"));
  if (rootPackage.version !== desktopPackage.version) {
    throw new Error(
      `Desktop version ${desktopPackage.version} must match application version ${rootPackage.version}`,
    );
  }

  if (!skipNextBuild) {
    run(process.execPath, [buildScript], {
      ...process.env,
      DB_PROVIDER: "sqlite",
      DATABASE_URL: "file:./data/campfire-desktop-build.db",
    });
  }

  const standaloneDirectory = join(projectRoot, ".next", "standalone");
  if (!existsSync(standaloneDirectory)) {
    throw new Error("Next standalone output is missing; run without --skip-next-build first");
  }
  const candidates = collectStandaloneRoots(standaloneDirectory);
  if (candidates.length !== 1) {
    throw new Error(`Expected one standalone app root, found ${candidates.length}`);
  }

  assertInside(desktopRoot, stageRoot);
  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true });
  cpSync(candidates[0], stageRoot, { recursive: true, dereference: true });
  cpSync(join(projectRoot, ".next", "static"), join(stageRoot, ".next", "static"), {
    recursive: true,
    dereference: true,
  });
  cpSync(join(projectRoot, "public"), join(stageRoot, "public"), {
    recursive: true,
    dereference: true,
  });

  await build({
    entryPoints: [join(projectRoot, "server.ts")],
    outfile: join(stageRoot, "campfire-server.bundle.mjs"),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    banner: {
      js: 'import { createRequire as __campfireCreateRequire } from "node:module"; const require = __campfireCreateRequire(import.meta.url);',
    },
    external: ["better-sqlite3", "next", "next/*"],
    plugins: [directRunGuardPlugin()],
    legalComments: "none",
    logLevel: "info",
  });

  // The custom server bundle is ESM, while Next's public subpath shims are
  // extensionless CommonJS imports. Node ESM requires the explicit `.js`, and
  // standalone tracing omits headers.js because the custom server sits outside
  // Next's route traces. Keep this packaging-only compatibility shim narrow.
  const serverBundlePath = join(stageRoot, "campfire-server.bundle.mjs");
  const originalBundle = readFileSync(serverBundlePath, "utf8");
  const rewrittenBundle = originalBundle
    .replaceAll('"next/headers"', '"next/headers.js"')
    .replaceAll("'next/headers'", "'next/headers.js'");
  if (rewrittenBundle === originalBundle || /["']next\/headers["']/.test(rewrittenBundle)) {
    throw new Error("Could not rewrite the next/headers ESM specifier in the desktop bundle");
  }
  writeFileSync(serverBundlePath, rewrittenBundle);

  const nextHeadersSource = join(projectRoot, "node_modules", "next", "headers.js");
  const nextHeadersDestination = join(stageRoot, "node_modules", "next", "headers.js");
  if (!existsSync(nextHeadersSource)) {
    throw new Error(`Next headers entry shim is missing: ${nextHeadersSource}`);
  }
  cpSync(nextHeadersSource, nextHeadersDestination);

  // `next()` custom-server startup loads config-utils, which dynamically asks
  // for this compiled runtime. The minimal standalone server does not, so NFT
  // cannot see it from route traces. Copy only the 2.5 MB runtime directory.
  const nextWebpackSource = join(projectRoot, "node_modules", "next", "dist", "compiled", "webpack");
  const nextWebpackDestination = join(
    stageRoot,
    "node_modules",
    "next",
    "dist",
    "compiled",
    "webpack",
  );
  cpSync(nextWebpackSource, nextWebpackDestination, { recursive: true, dereference: true });

  // The same dynamic alias table resolves @babel/runtime by its package.json.
  // Copying this 236 KB compiled shim completes that table without staging the
  // remaining ~135 MB of Next's build-only compiled dependencies.
  const nextBabelRuntimeSource = join(
    projectRoot,
    "node_modules",
    "next",
    "dist",
    "compiled",
    "@babel",
    "runtime",
  );
  const nextBabelRuntimeDestination = join(
    stageRoot,
    "node_modules",
    "next",
    "dist",
    "compiled",
    "@babel",
    "runtime",
  );
  cpSync(nextBabelRuntimeSource, nextBabelRuntimeDestination, {
    recursive: true,
    dereference: true,
  });

  // ESM evaluates static dependencies before module bodies. A separate dynamic
  // bootstrap guarantees Next sees AsyncLocalStorage before any `next` module
  // initializes, matching the ordering contract in lib/als-polyfill.ts.
  writeFileSync(
    join(stageRoot, "campfire-server.mjs"),
    [
      'import { AsyncLocalStorage } from "node:async_hooks";',
      "if (!globalThis.AsyncLocalStorage) globalThis.AsyncLocalStorage = AsyncLocalStorage;",
      'await import("./campfire-server.bundle.mjs");',
      "",
    ].join("\n"),
  );

  createDatabaseTemplate();

  const installedBetterSqlite3 = join(projectRoot, "node_modules", "better-sqlite3");
  const stagedBetterSqlite3 = join(stageRoot, "node_modules", "better-sqlite3");
  const nativeBuildInputs = ["binding.gyp", "deps", "src"];
  for (const entry of nativeBuildInputs) {
    const source = join(installedBetterSqlite3, entry);
    const destination = join(stagedBetterSqlite3, entry);
    if (!existsSync(source)) {
      throw new Error(`better-sqlite3 build input is missing: ${source}`);
    }
    cpSync(source, destination, { recursive: true, dereference: true });
  }

  const electronPackage = JSON.parse(
    readFileSync(join(projectRoot, "node_modules", "electron", "package.json"), "utf8"),
  );
  try {
    // Next's standalone trace keeps the Node prebuild but omits binding.gyp and
    // source files. Overlay those build-only inputs so electron-rebuild can
    // actually discover the module, then prove the result in Electron itself.
    await rebuild({
      buildPath: stageRoot,
      electronVersion: electronPackage.version,
      arch: process.arch,
      force: true,
      onlyModules: ["better-sqlite3"],
    });

    const electronExecutable = join(
      projectRoot,
      "node_modules",
      "electron",
      "dist",
      process.platform === "win32" ? "electron.exe" : "electron",
    );
    const nativeProbe = [
      `const Database = require(${JSON.stringify(stagedBetterSqlite3)});`,
      'const database = new Database(":memory:");',
      'database.prepare("SELECT 1 AS ok").get();',
      "database.close();",
    ].join(" ");
    run(electronExecutable, ["-e", nativeProbe], {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    });

    // node-gyp leaves roughly 60 MB of object files and symbols beside the
    // 1.9 MB runtime binary. Preserve only the binary the bindings loader uses.
    const nativeBinaryPath = join(
      stagedBetterSqlite3,
      "build",
      "Release",
      "better_sqlite3.node",
    );
    const nativeBinary = readFileSync(nativeBinaryPath);
    const nativeBuildDirectory = join(stagedBetterSqlite3, "build");
    assertInside(stageRoot, nativeBuildDirectory);
    rmSync(nativeBuildDirectory, { recursive: true, force: true });
    mkdirSync(dirname(nativeBinaryPath), { recursive: true });
    writeFileSync(nativeBinaryPath, nativeBinary);

    const nativePrebuildDirectory = join(stagedBetterSqlite3, "bin");
    assertInside(stageRoot, nativePrebuildDirectory);
    rmSync(nativePrebuildDirectory, { recursive: true, force: true });
  } finally {
    for (const entry of nativeBuildInputs) {
      const buildInput = join(stagedBetterSqlite3, entry);
      assertInside(stageRoot, buildInput);
      rmSync(buildInput, { recursive: true, force: true });
    }
  }

  const requiredPaths = [
    join(stageRoot, "campfire-server.mjs"),
    join(stageRoot, "campfire-server.bundle.mjs"),
    join(stageRoot, "campfire-template.db"),
    join(stageRoot, ".next", "BUILD_ID"),
    join(stageRoot, ".next", "required-server-files.json"),
    join(stageRoot, "node_modules", "next", "package.json"),
    join(stageRoot, "node_modules", "next", "headers.js"),
    join(stageRoot, "node_modules", "next", "dist", "compiled", "webpack", "webpack-lib.js"),
    join(stageRoot, "node_modules", "next", "dist", "compiled", "webpack", "webpack.js"),
    join(stageRoot, "node_modules", "next", "dist", "compiled", "@babel", "runtime", "package.json"),
    join(stageRoot, "node_modules", "better-sqlite3", "package.json"),
    join(stageRoot, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
    join(stageRoot, "public", "Campfire-Icon.png"),
  ];
  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath) || statSync(requiredPath).size === 0) {
      throw new Error(`Desktop staging output is incomplete: ${requiredPath}`);
    }
  }

  console.log(`[Campfire] Desktop server staged at ${stageRoot}`);
}

main().catch((error) => {
  console.error("[Campfire] Desktop staging failed:", error);
  process.exitCode = 1;
});
