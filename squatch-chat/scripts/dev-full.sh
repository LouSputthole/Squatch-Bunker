#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Run setup (idempotent — skips what's already done)
bash scripts/setup.sh

echo ""
echo "  Starting SquatchChat..."
echo ""

# Start realtime server in background
pnpm dev:realtime &
REALTIME_PID=$!

# Start Next.js
pnpm dev &
NEXT_PID=$!

echo ""
echo "  SquatchChat is running!"
echo "  -> App:      http://localhost:3000"
echo "  -> Realtime: ws://localhost:3001"
echo ""
echo "  Press Ctrl+C to stop"
echo ""

cleanup() {
  echo ""
  echo "  Shutting down..."
  kill $REALTIME_PID 2>/dev/null
  kill $NEXT_PID 2>/dev/null
  wait $REALTIME_PID 2>/dev/null
  wait $NEXT_PID 2>/dev/null
  echo "  SquatchChat stopped."
}
trap cleanup EXIT INT TERM

wait
