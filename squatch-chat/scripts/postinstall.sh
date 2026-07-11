#!/usr/bin/env bash
# Auto-create .env from .env.example if it doesn't exist
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$SCRIPT_DIR/.env" ] && [ -f "$SCRIPT_DIR/.env.example" ]; then
  cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  echo "[Campfire] Created .env from .env.example — edit it with your database credentials"
fi

SCHEMA="$SCRIPT_DIR/prisma/schema.prisma"

# Detect DB_PROVIDER from DATABASE_URL if not already set.
# When DATABASE_URL is unset or starts with "file:", default to sqlite.
if [ -z "${DB_PROVIDER}" ]; then
  if [ -z "${DATABASE_URL}" ] || [[ "${DATABASE_URL}" == file:* ]]; then
    export DB_PROVIDER="sqlite"
  else
    export DB_PROVIDER="postgresql"
  fi
fi

# Temporarily rewrite the datasource provider in the schema to match DB_PROVIDER,
# since Prisma 7 does not support env() in the provider field.
ORIGINAL_PROVIDER=$(grep -o 'provider = "[^"]*"' "$SCHEMA" | head -2 | tail -1 | sed 's/provider = "\(.*\)"/\1/')
RESTORE_PROVIDER=""
if [ "${DB_PROVIDER}" != "${ORIGINAL_PROVIDER}" ]; then
  sed -i "s/  provider = \"${ORIGINAL_PROVIDER}\"/  provider = \"${DB_PROVIDER}\"/" "$SCHEMA"
  RESTORE_PROVIDER="${ORIGINAL_PROVIDER}"
fi

cleanup() {
  if [ -n "${RESTORE_PROVIDER}" ]; then
    sed -i "s/  provider = \"${DB_PROVIDER}\"/  provider = \"${RESTORE_PROVIDER}\"/" "$SCHEMA"
  fi
}
trap cleanup EXIT

# Ensure DATABASE_URL has a default for SQLite if not set
if [ -z "${DATABASE_URL}" ] && [ "${DB_PROVIDER}" = "sqlite" ]; then
  export DATABASE_URL="file:./dev.db"
fi

# Generate Prisma client
npx prisma generate 2>/dev/null || echo "[Campfire] Prisma generate skipped (run pnpm db:generate after configuring .env)"
