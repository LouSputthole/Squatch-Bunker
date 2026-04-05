#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="campfire-db"
TRIES="${1:-30}"

# Try Docker container first
if command -v docker >/dev/null 2>&1; then
  for i in $(seq 1 "$TRIES"); do
    if docker exec "$CONTAINER_NAME" pg_isready -U postgres -d campfire >/dev/null 2>&1; then
      echo "Postgres is ready."
      exit 0
    fi
    sleep 1
  done
fi

# Try local pg_isready as fallback
if command -v pg_isready >/dev/null 2>&1; then
  for i in $(seq 1 "$TRIES"); do
    if pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
      echo "Postgres is ready."
      exit 0
    fi
    sleep 1
  done
fi

echo "Error: Postgres did not become ready in ${TRIES}s."
exit 1
