#!/usr/bin/env bash
# VPS deploy: pull code, restart with pre-pushed images.
# For CI/CD: use build-and-push.sh on local machine first.
# This script is for cases where you just pulled new code/config.
set -euo pipefail

cd "$(dirname "$0")"

echo "=== Pulling latest code ==="
git pull

echo "=== Restarting containers ==="
docker compose down --remove-orphans 2>/dev/null || true
docker compose up -d --force-recreate

echo "=== Pruning old images ==="
docker image prune -f 2>/dev/null || true

echo "=== Done ==="
docker compose ps
