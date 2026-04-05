#!/usr/bin/env bash
# Auto-create .env from .env.example if it doesn't exist
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$SCRIPT_DIR/.env" ] && [ -f "$SCRIPT_DIR/.env.example" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  echo "[Campfire] Created .env from .env.example — edit it with your database credentials"
fi

# Generate Prisma client
npx prisma generate 2>/dev/null || echo "[Campfire] Prisma generate skipped (run pnpm db:generate after configuring .env)"
