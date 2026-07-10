# Campfire Desktop (Windows, portable)

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

No telemetry, no auto-update calls.

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
back to `%APPDATA%\Campfire\`.

## Updating

- **Portable:** download the new folder and copy your existing `data\` folder
  into it. Migrations run automatically on next launch; only app files change.
- **Installed:** run the new installer. There is **no auto-updater** yet — by
  design (no phone-home).

## Security posture

- Renderer is `sandbox: true`, `contextIsolation: true`, `nodeIntegration:
  false`, with a minimal preload.
- Navigation is pinned to `http://127.0.0.1:<port>` / `localhost:<port>`; any
  other URL is opened in the real browser, never in-app. `window.open` is denied
  (http/https handed to the browser).
- The JWT secret is generated once with `crypto.randomBytes(32)` and stored in
  the data dir — same posture as a self-host `.env` secret.
- The server binds `127.0.0.1` only.

## Known limitations

- **Windows x64 only** right now (the build chain and better-sqlite3 ABI swap
  are wired for `win`/`x64`).
- **No code signing** — Windows SmartScreen will warn on first run of an
  unsigned exe/installer. (Add a cert under `win.signtoolOptions` to sign.)
- **No auto-update.** Updates are manual (see above).
- Sharing across a network is the job of the self-host server build, not the
  desktop app (which binds localhost).

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
