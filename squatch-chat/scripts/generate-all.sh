#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Generating Prisma client for PostgreSQL..."
npx prisma generate --schema "$PROJECT_DIR/prisma/schema.prisma"

echo "Generating Prisma client for SQLite..."
npx prisma generate --schema "$PROJECT_DIR/prisma/schema.sqlite.prisma"

echo "Both Prisma clients generated successfully."
