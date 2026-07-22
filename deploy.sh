#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=== Pulling latest code ==="
git pull

echo "=== Building & restarting ==="
docker compose up --build -d

echo "=== Done ==="