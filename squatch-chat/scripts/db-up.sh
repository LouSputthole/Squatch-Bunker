#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="campfire-db"
VOLUME_NAME="campfire-data"
IMAGE="postgres:16-alpine"

# Check for Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker is not installed."
  echo ""
  echo "Install Docker from: https://docs.docker.com/get-docker/"
  echo "  - Windows/Mac: Docker Desktop"
  echo "  - Linux: sudo apt install docker.io  or  sudo dnf install docker"
  exit 1
fi

# Already running
if docker ps --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Postgres already running."
  exit 0
fi

# Exists but stopped
if docker ps -a --format '{{.Names}}' | grep -qx "$CONTAINER_NAME"; then
  echo "Starting existing Postgres container..."
  docker start "$CONTAINER_NAME" >/dev/null
  echo "Postgres container started."
  exit 0
fi

# Create fresh
echo "Creating Postgres container..."
docker volume create "$VOLUME_NAME" >/dev/null 2>&1 || true

docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=campfire \
  -p 5432:5432 \
  -v "$VOLUME_NAME:/var/lib/postgresql/data" \
  "$IMAGE" >/dev/null

echo "Postgres container started."
