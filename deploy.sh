#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=== Pulling latest code ==="
git pull

echo "=== Stopping old containers ==="
docker compose down --remove-orphans 2>/dev/null || true

echo "=== Building & starting ==="
docker compose up --build -d --force-recreate

echo "=== Pruning old images ==="
docker image prune -f 2>/dev/null || true

echo "=== Done ==="
docker compose ps
