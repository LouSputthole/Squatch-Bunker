#!/usr/bin/env bash
# ──────────────────────────────────────────────
# Campfire — One-Command Host
# Runs everything on a single port. Share the URL.
# Usage:  npm run host
#         PORT=8080 npm run host
# ──────────────────────────────────────────────
set -e
cd "$(dirname "$0")/.."

export PORT="${PORT:-3000}"

# Generate JWT secret if not set
if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "campfire-host-$(date +%s)")
fi

npx tsx server.ts
