#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
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

echo "[Campfire] Using DB_PROVIDER=${DB_PROVIDER}"

# Rewrite schema provider to match DB_PROVIDER, then restore after generate.
# This is necessary because Prisma 7 does not support env() in the provider field.
ORIGINAL_PROVIDER=$(grep -o 'provider = "[^"]*"' "$SCHEMA" | head -2 | tail -1 | sed 's/provider = "\(.*\)"/\1/')
RESTORE_PROVIDER=""
if [ "${DB_PROVIDER}" != "${ORIGINAL_PROVIDER}" ]; then
  sed -i "s/  provider = \"${ORIGINAL_PROVIDER}\"/  provider = \"${DB_PROVIDER}\"/" "$SCHEMA"
  RESTORE_PROVIDER="${ORIGINAL_PROVIDER}"
fi

# Ensure DATABASE_URL has a default for SQLite if not set
if [ -z "${DATABASE_URL}" ] && [ "${DB_PROVIDER}" = "sqlite" ]; then
  export DATABASE_URL="file:./dev.db"
fi

# Generate and build, restore schema provider on exit
cleanup() {
  if [ -n "${RESTORE_PROVIDER}" ]; then
    sed -i "s/  provider = \"${DB_PROVIDER}\"/  provider = \"${RESTORE_PROVIDER}\"/" "$SCHEMA"
  fi
}
trap cleanup EXIT

npx prisma generate
npx next build
