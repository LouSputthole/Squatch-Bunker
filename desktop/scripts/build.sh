#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$DESKTOP_DIR/../squatch-chat"

echo "=== Building Campfire Desktop ==="

# Step 1: Build web app (standalone mode)
echo "[1/3] Building Next.js app..."
cd "$WEB_DIR"
pnpm build

# Step 2: Install desktop dependencies
echo "[2/3] Installing Electron dependencies..."
cd "$DESKTOP_DIR"
npm install

# Step 3: Package with electron-builder
echo "[3/3] Packaging desktop app..."
npm run dist

echo ""
echo "=== Done! Installer is in desktop/dist/ ==="
