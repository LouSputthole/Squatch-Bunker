# Desktop build — gotchas & decisions

Non-obvious things that cost time. Read before changing `build-desktop.mjs`,
`src/server-desktop.ts`, or the electron-builder config.

## 1. The custom server can't be the Next standalone `server.js`

`squatch-chat` uses a custom server (`server.ts`) that attaches Socket.IO to the
HTTP server. Next's standalone `server.js` uses `startServer()` internally and
gives you no handle to the HTTP server, so you can't attach Socket.IO to it.

Instead `server-desktop.ts` runs the **classic** `next({ dev:false, dir, conf })`
+ `createServer()` + `attachSocketIO()` against the standalone build. The
resolved Next config is read from `.next/required-server-files.json` (`.config`)
and also stuffed into `process.env.__NEXT_PRIVATE_STANDALONE_CONFIG`, so no
`next.config` file is needed at runtime. Verified: this serves fine against the
trimmed standalone `.next`.

## 2. esbuild + `import.meta.url` in CJS

The generated Prisma client does `fileURLToPath(import.meta.url)` at module load;
under `format: "cjs"` esbuild leaves `import.meta.url` empty → `fileURLToPath`
throws. Fix: a banner defines `__IMPORT_META_URL__` as a **synthetic** file URL in
the bundle dir and `define` maps `import.meta.url` → it. It's deliberately a
*different* filename than the bundle so `realtime/server.ts`'s "am I the direct
entry?" check (`import.meta.url === pathToFileURL(argv[1]).href`) stays false and
the stray port-3001 standalone listener never fires.

## 3. `next/headers` doesn't resolve under Electron

`lib/auth.ts` imports `cookies` from `next/headers` at module scope (used only by
`getSession`, which the socket layer never calls). `next/headers` resolves via
next's `exports` map, which the standalone require-hook can't resolve under
Electron → `MODULE_NOT_FOUND`. Fix: esbuild `alias` maps `next/headers` to
`src/shims/next-headers.ts` (throwing stubs). Only affects our bundle; the Next
app's own `next/headers` usage is compiled separately into `.next/server`.

## 4. better-sqlite3 ABI — the big one

better-sqlite3 is a NAN/V8 addon (ABI-specific), unlike sharp (N-API, ABI-stable
— sharp needs no rebuild). Three traps:

- `@electron/rebuild` reported success but **left the Node-ABI binary in place**.
  `prebuild-install -r electron -t <ver>` reliably fetches the Electron-ABI
  prebuilt binary (no C++ toolchain needed). It's now the primary path.
- `next build` re-copies the **Node-ABI** binary from source into the standalone
  tree every build, so the ABI swap MUST run *after* the web build.
- Next junctions a **hashed copy** into `.next/node_modules/better-sqlite3-<hash>`
  pointing at the SOURCE `squatch-chat/node_modules/better-sqlite3` (Node ABI) —
  and the compiled server loads THAT copy, not the top-level one. We can't rebuild
  the source (it would break `npm run host`). Fix: `materializeBundledModules()`
  replaces each junction in `.next/node_modules` with a real copy (better-sqlite3
  from our Electron-ABI module), then every `better_sqlite3.node` is `dlopen`-ed
  under Electron to prove the ABI. Symptom when this is wrong: `/login` works but
  any DB write 503s with `NODE_MODULE_VERSION 137 … requires 133`.

## 5. electron-builder quirks

- `extraResources` copying a directory **skips `node_modules`** during recursion,
  so the standalone `node_modules` and `.next/node_modules` need **explicit**
  `from`/`to` entries pointing straight at them.
- `win.publisherName` was removed in electron-builder 26 (`additionalProperties:
  false`) — it now lives under `win.signtoolOptions`. Leaving it at `win` level
  fails schema validation with a cryptic "configuration.win should be null".
- `win.target` uses string form `["dir", "nsis"]`, not object form.
- Stray dev files Next copies into standalone (`.env` with the dev JWT secret,
  `data/`) are deleted by `cleanStandalone()` before packaging.

## 6. Orphan prevention

The server child is spawned as `Campfire.exe` (ELECTRON_RUN_AS_NODE), so it's
same-named as the app. Normal quit → `before-quit` → `killServer()` (SIGTERM,
then `taskkill /T /F` after 3s). For force-kill/crash of the main process,
`server-desktop.ts` also polls `CAMPFIRE_PARENT_PID` and self-exits if the parent
disappears — so no orphaned server is possible.
