#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="squatch-db"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed."
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  docker stop "$CONTAINER_NAME" >/dev/null
  echo "Postgres container stopped."
  exit 0
fi

echo "Postgres container is not running."
