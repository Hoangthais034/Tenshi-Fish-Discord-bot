#!/bin/bash
set -e

echo "=== Building and deploying Discord Bot ==="

# Load .env
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

# Build and start
docker compose build bot
docker compose up -d --remove-orphans

echo "=== Deploy complete ==="
echo "Check status: docker compose ps"
echo "View logs: docker compose logs -f bot"
