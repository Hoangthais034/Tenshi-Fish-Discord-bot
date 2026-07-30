#!/bin/bash
set -e

echo "=== Deploy Discord Bot ==="

git pull
echo "=== Pulling latest changes Done ==="

docker compose up -d --build

echo "=== Build Done ==="