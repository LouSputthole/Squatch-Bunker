# Campfire Desktop (archived implementation)

> **Do not build or publish this package.** This repository-root implementation
> is retained only so its tray, LAN-sharing, and update-checker work can be
> ported later. Its migration bundle predates the current Campfire schema, so
> its start and build scripts intentionally fail closed. The supported pipeline
> is under `squatch-chat/desktop` and `squatch-chat/packaging`; run
> `npm run desktop:stage`, `npm run desktop:verify`, or `npm run desktop:dist`
> from `squatch-chat` and follow `squatch-chat/docs/RELEASE_CHECKLIST.md`.

Packages Campfire — the self-hosted, Discord-style chat app — as a Windows
desktop app that runs with **no install and no Node.js required**. Ships as a
portable folder (unzip and run) and as an NSIS installer.

## Architecture

Everything is local. Electron owns the window and boots the real Campfire
server (Next.js + Socket.IO) as a child process, on **one dynamically-chosen
port** (single-port mode — the client talks to its own page origin, so no URLs
are baked into the build).

```
Campfire.exe  (Electron main — main.js)
  │  picks a free port, generates/loads the JWT secret, resolves the data dir
  │
  ├─ spawn(process.execPath, ["server-desktop.js"], { ELECTRON_RUN_AS_NODE: 1 })
  │     └─ Campfire server (embedded Node — no system Node needed)
  │          ├─ applies SQLite migrations (better-sqlite3, no Prisma CLI)
  │          ├─ Next.js request handler  ─┐
  │          ├─ Socket.IO (same server)  ─┤ one HTTP server, one port
  │          └─ /uploads + /avatars  ─────┘ served from the data dir
  │
  └─ BrowserWindow → http://127.0.0.1:<port>   (sandboxed, context-isolated)
         └─ splash screen until the server answers
```

### Why Electron (and why `ELECTRON_RUN_AS_NODE`)

Campfire is not a static site — it needs a real Node server (Next.js SSR,
Socket.IO, Prisma/SQLite). Electron already embeds Node, so we spawn the server
with `ELECTRON_RUN_AS_NODE=1` and `process.execPath` (i.e. `Campfire.exe` acting
as Node). That removes the system-Node dependency entirely: the portable folder
runs on a machine with nothing installed.

Tauri was considered and rejected: its runtime is Rust/WebView with no bundled
Node, so it would still need a separate Node sidecar to run this server — no net
win over Electron here, and more moving parts.

### What's local vs. remote

**Everything is local.** The database, uploads, auth, realtime and web UI all
run on this machine. The internet is only touched for:

- **Cross-internet voice** — WebRTC needs STUN/TURN to traverse NAT between
  people on different networks. On a LAN it's peer-to-peer with no server.
- **GIF picker** — optional, only if `GIPHY_API_KEY` / `TENOR_API_KEY` are set
  (off by default; the picker just shows a hint otherwise).
- **OAuth login & Stripe** — optional, only if you configure those providers.
- **Update check** — one GET to `api.github.com` for the latest release tag
  (15s after launch, packaged builds only, plus the tray's "Check for
  updates…"). Version compare only; nothing is downloaded or sent.

No telemetry.

## Build

```bash
cd desktop
npm install                 # electron, electron-builder, @electron/rebuild, esbuild

npm run build:all           # portable folder + zip + NSIS installer  (default)
npm run build:portable      # portable folder + zip only
npm run build:installer     # NSIS installer only
```

`build-desktop.mjs` runs the whole chain:

1. **Web build** of `squatch-chat` (SQLite provider, `NEXT_PUBLIC_*` blanked so
   nothing but same-origin is baked in) → Next `standalone` output.
2. **esbuild** bundles `src/server-desktop.ts` (+ the real `realtime/server.ts`,
   `lib/*`, the generated Prisma client, socket.io, jsonwebtoken…) into one
   `server-desktop.js` dropped into the standalone tree. `next`, `react`,
   `react-dom`, `@prisma/client` and `better-sqlite3` stay external and resolve
   from the traced `node_modules`.
3. **better-sqlite3 → Electron ABI** via `prebuild-install -r electron`. Next
   also junctions a hashed copy into `.next/node_modules`; those junctions are
   materialized into real copies and every `better_sqlite3.node` is verified by
   `dlopen` under Electron.
4. **electron-builder** produces `win-unpacked` + the NSIS installer.
5. The portable folder is assembled from `win-unpacked` (rename → `Campfire`,
   add `portable.txt` + `README.txt`) and zipped.

Artifacts land in `desktop/dist/`:

- `Campfire/` — the portable folder
- `Campfire-Portable-Windows-x64.zip`
- `Campfire-Setup-0.0.2-x64.exe`

Icons are generated from `icons/icon.png` (1024²) by `npm run icons`
(`scripts/make-icons.mjs`) → `icon.ico` + a 32×32 `tray-icon.png`.

## Data locations

| Mode | Trigger | Data dir |
|------|---------|----------|
| **Portable** | `portable.txt` sits next to `Campfire.exe` **and** the folder is writable | `<folder>\data\` |
| **Installed** | NSIS install (no `portable.txt`) | `%APPDATA%\Campfire\` |

The data dir holds `campfire.db` (+ WAL files), `secret` (per-install JWT
signing key), `settings.json` (window bounds + tray preference), `runtime.json`
(current port/pid — handy for debugging), `uploads/`, `avatars/`, and `logs/`.

If the exe folder is read-only (e.g. a locked USB), the portable build falls
back to `%APPDATA%\Campfire\`. When that happens it's logged as a WARNING in
`logs\server.log` and `runtime.json` reports `"dataDirMode": "portable-fallback"`
— the data will NOT travel with the folder until the write issue is fixed.

## LAN sharing

Off by default (the server binds `127.0.0.1`). Tray → **"Share on this
network"** rebinds the server to `0.0.0.0` on port **3939** (fixed, so the link
survives restarts; falls back to a random port if 3939 is taken) and the tray
gains a **Copy LAN link** entry (`http://<your-LAN-IP>:3939`). Friends on the
same network open that link in a browser and register/log in like any
self-hosted Campfire.

- Windows Firewall will ask to allow Campfire on first share — click Allow.
- While sharing is on, anyone on the local network can reach the login page.
  Auth still gates everything behind it.
- LAN visitors get text + browsing but **no microphone**: browsers only
  unlock getUserMedia on secure origins, and LAN sharing is plain HTTP (the
  hosting machine itself is exempt via `127.0.0.1`). Voice for others =
  the HTTPS deploy (`squatch-chat/docs/DEPLOY.md`).
- Internet-wide hosting is the self-host server's job (see the deployment
  docs), not the desktop app's.

## Updating

The app checks GitHub for a newer release at launch (packaged builds only) and
offers Download / Later / Skip-this-version; tray → "Check for updates…" checks
on demand. Release tags must be `vX.Y.Z` matching `squatch-chat/package.json`'s
version, which `build-desktop.mjs` stamps into the app via
`extraMetadata.version`.

- **Portable:** download the new folder and copy your existing `data\` folder
  into it. Migrations run automatically on next launch; only app files change.
- **Installed:** run the new installer. There is **no auto-download** — the
  updater only opens the release page in your browser.

## Security posture

- Renderer is `sandbox: true`, `contextIsolation: true`, `nodeIntegration:
  false`, with a minimal preload.
- Navigation is pinned to `http://127.0.0.1:<port>` / `localhost:<port>`; any
  other URL is opened in the real browser, never in-app. `window.open` is denied
  (http/https handed to the browser).
- The JWT secret is generated once with `crypto.randomBytes(32)` and stored in
  the data dir — same posture as a self-host `.env` secret.
- The server binds `127.0.0.1` unless "Share on this network" is on, in which
  case it binds `0.0.0.0` (LAN exposure is the point; auth still applies).

## Known limitations

- **Windows x64 only** right now (the build chain and better-sqlite3 ABI swap
  are wired for `win`/`x64`).
- **No code signing** — Windows SmartScreen will warn on first run of an
  unsigned exe/installer. (Add a cert under `win.signtoolOptions` to sign.)
- **No auto-download of updates** — the checker only notifies and links to the
  release page.
- LAN sharing covers the local network only; internet-wide hosting is the job
  of the self-host server build (see `docs/`).

## Troubleshooting

- App won't start / crashes: read `data\logs\server.log`. The app also shows a
  branded dialog with the last ~20 log lines and the log path.
- Reset everything: quit Campfire and delete the `data\` folder (this deletes
  your local database).
- Report issues: <https://github.com/LouSputthole/Squatch-Bunker/issues>

## Dev run

`npm start` runs `electron .` against `../squatch-chat/.next/standalone`, so do a
build first (it needs `server-desktop.js` + the Electron-ABI better-sqlite3 in
the standalone tree). There is no separate hot-reload dev mode; for iterating on
the web app use `cd ../squatch-chat && npm run host`.
