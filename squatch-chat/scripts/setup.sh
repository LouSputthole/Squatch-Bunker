#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo ""
echo "  SquatchChat Setup"
echo "  ================="
echo ""

# 1. Create .env if missing
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    echo "  [ok] Created .env from .env.example"
  else
    echo "  [!!] .env.example not found"
    exit 1
  fi
else
  echo "  [ok] .env already exists"
fi

# 2. Install dependencies if needed
if [ ! -d node_modules ]; then
  echo "  [..] Installing dependencies..."
  pnpm install
fi

# 3. Start database
echo "  [..] Starting database..."
bash scripts/db-up.sh

# 4. Wait for database
echo "  [..] Waiting for database..."
bash scripts/db-wait.sh

# 5. Generate Prisma client
echo "  [..] Generating Prisma client..."
npx prisma generate

# 6. Run migrations
echo "  [..] Running migrations..."
npx dotenv -e .env -- npx prisma migrate deploy 2>/dev/null || {
  echo "  [..] No migrations applied yet, running initial migration..."
  npx dotenv -e .env -- npx prisma migrate dev --name init
}

echo ""
echo "  Setup complete!"
echo ""
