#!/usr/bin/env bash
# Build Docker images locally, export to tar, and push to VPS.
# Usage: ./build-and-push.sh [vps-host]
set -euo pipefail

cd "$(dirname "$0")"

VPS="${1:-oracle-vps}"
REMOTE_DIR="~/apps/Tenshi-Fish-Discord-bot"
IMAGE_DIR="/tmp/docker-images"

echo "=== Building images locally ==="
docker compose build

echo "=== Exporting images ==="
mkdir -p "$IMAGE_DIR"
docker save tenshi-fish-discord-bot-bot:latest | gzip > "$IMAGE_DIR/bot.tar.gz"
docker save tenshi-fish-discord-bot-lavalink:latest | gzip > "$IMAGE_DIR/lavalink.tar.gz"
echo "Bot:     $(du -h "$IMAGE_DIR/bot.tar.gz" | cut -f1)"
echo "Lavalink: $(du -h "$IMAGE_DIR/lavalink.tar.gz" | cut -f1)"

echo "=== Pushing to $VPS ==="
scp "$IMAGE_DIR/bot.tar.gz" "$IMAGE_DIR/lavalink.tar.gz" "$VPS:$REMOTE_DIR/"

echo "=== Loading on VPS ==="
ssh "$VPS" << 'REMOTE'
set -euo pipefail
cd ~/apps/Tenshi-Fish-Discord-bot
echo "--- Loading bot image ---"
gunzip -c bot.tar.gz | docker load
echo "--- Loading lavalink image ---"
gunzip -c lavalink.tar.gz | docker load
rm -f bot.tar.gz lavalink.tar.gz
echo "--- Restarting containers ---"
docker compose down --remove-orphans 2>/dev/null || true
docker compose up -d --force-recreate
docker image prune -f 2>/dev/null || true
echo "--- Done ---"
docker compose ps
REMOTE

echo "=== Cleaning up local temp ==="
rm -rf "$IMAGE_DIR"
echo "=== Deploy complete ==="
