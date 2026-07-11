# Campfire Desktop

Electron wrapper that packages Campfire as a native desktop app with installer.

## How It Works

```
┌─────────────────────────────┐
│  Electron (main.js)         │
│  ├─ Spawns Next.js server   │  ← port 3000
│  ├─ Spawns Socket.IO server │  ← port 3001
│  ├─ Opens BrowserWindow     │  ← loads localhost:3000
│  └─ Splash screen while     │
│     servers start up         │
└─────────────────────────────┘
```

The desktop app bundles the full web app. On launch it starts both servers internally, waits for them to be ready, then opens the main window.

## Development

```bash
cd desktop
npm install

# Run in dev mode (uses squatch-chat dev server)
npm run dev
```

## Building Installers

```bash
# Full build (web + desktop)
bash scripts/build.sh

# Or step by step:
cd ../squatch-chat && pnpm build   # Build Next.js standalone
cd ../desktop && npm run dist       # Package with electron-builder

# Platform-specific:
npm run dist:win     # Windows (.exe installer)
npm run dist:mac     # macOS (.dmg)
npm run dist:linux   # Linux (.AppImage + .deb)
```

Output goes to `desktop/dist/`.

## Icons

Place platform-specific icons in `icons/`:
- `icon.png` — 512x512 PNG (Linux + fallback)
- `icon.ico` — Windows icon (use online converter)
- `icon.icns` — macOS icon (use online converter)
- `tray-icon.png` — 16x16 or 32x32 for system tray

## What the Installer Does

**Windows (NSIS):**
- Lets user choose install location
- Creates desktop shortcut + start menu entry
- Adds uninstaller to Add/Remove Programs

**macOS (DMG):**
- Drag-to-Applications style installer

**Linux (AppImage/deb):**
- AppImage: portable, run from anywhere
- deb: installs to system, adds to app menu
