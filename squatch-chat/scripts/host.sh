#!/usr/bin/env bash
# ──────────────────────────────────────────────
# Campfire — Quick Host Script
# Starts the app so others on your network (or internet) can connect.
# Usage:  ./scripts/host.sh
#         ./scripts/host.sh --port 8080
# ──────────────────────────────────────────────
set -e

APP_PORT="${1:-3000}"
SOCKET_PORT="${2:-3001}"

# Detect LAN IP
detect_ip() {
  # Try multiple methods to find local IP
  if command -v ip &>/dev/null; then
    ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") print $(i+1)}' | head -1
  elif command -v ifconfig &>/dev/null; then
    ifconfig | grep 'inet ' | grep -v '127.0.0.1' | awk '{print $2}' | head -1
  elif command -v hostname &>/dev/null; then
    hostname -I 2>/dev/null | awk '{print $1}'
  fi
}

LAN_IP=$(detect_ip)
if [ -z "$LAN_IP" ]; then
  echo "⚠  Could not detect LAN IP, using localhost"
  LAN_IP="localhost"
fi

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║          🏕️  Campfire is starting         ║"
echo "  ╠══════════════════════════════════════════╣"
echo "  ║                                          ║"
echo "  ║  Local:   http://localhost:${APP_PORT}         ║"
echo "  ║  Network: http://${LAN_IP}:${APP_PORT}     "
echo "  ║  Socket:  http://${LAN_IP}:${SOCKET_PORT}     "
echo "  ║                                          ║"
echo "  ║  Share the Network URL with others!      ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# Export env vars so both processes pick them up
export NEXT_PUBLIC_APP_URL="http://${LAN_IP}:${APP_PORT}"
export NEXT_PUBLIC_SOCKET_URL="http://${LAN_IP}:${SOCKET_PORT}"
export SOCKET_PORT="${SOCKET_PORT}"
export PORT="${APP_PORT}"

# Generate a random JWT secret if not set
if [ -z "$JWT_SECRET" ]; then
  export JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || echo "campfire-host-$(date +%s)")
fi

# Start realtime server in background
echo "[Campfire] Starting realtime server on port ${SOCKET_PORT}..."
npx tsx realtime/server.ts &
REALTIME_PID=$!

# Trap to kill background process on exit
cleanup() {
  echo ""
  echo "[Campfire] Shutting down..."
  kill $REALTIME_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# Start Next.js
echo "[Campfire] Starting web server on port ${APP_PORT}..."
npx next start -p "${APP_PORT}" -H 0.0.0.0
