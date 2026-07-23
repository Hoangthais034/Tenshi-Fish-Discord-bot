#!/usr/bin/env bash
# CI/CD: Build Docker images locally (Mac ARM64) → push to VPS (Linux AMD64)
# Usage: ./build-and-push.sh [vps-host]
#
# Fixes applied:
#   1. DOCKER_DEFAULT_PLATFORM=linux/amd64 — Mac ARM64 → VPS AMD64
#   2. Explicit image names in docker-compose.yml (tenshi-bot, tenshi-lavalink)
#   3. No 'docker image prune -a' on VPS (deletes freshly loaded images)
#   4. Wait for Lavalink healthcheck before declaring success
#
# Prerequisites:
#   - Docker Desktop running on Mac
#   - SSH key configured for VPS (ssh oracle-vps 'echo ok')
#   - .env file on VPS with all required variables
set -euo pipefail

cd "$(dirname "$0")"

VPS="${1:-oracle-vps}"
REMOTE_DIR="~/apps/Tenshi-Fish-Discord-bot"
IMAGE_DIR="/tmp/docker-images"

# ── Step 0: Pre-flight checks ───────────────────────────────
echo "=== Pre-flight checks ==="

# Check disk space (need ~1GB for build + export)
DISK_AVAIL=$(df -g / | awk 'NR==2 {print $4}')
if [ "$DISK_AVAIL" -lt 2 ]; then
  echo "ERROR: Only ${DISK_AVAIL}GB disk free. Need at least 2GB."
  echo "Run: docker system prune -a -f && docker builder prune -a -f"
  exit 1
fi
echo "Disk: ${DISK_AVAIL}GB free"

# Check Docker is running
docker info >/dev/null 2>&1 || { echo "ERROR: Docker Desktop not running"; exit 1; }

# Check VPS connectivity
ssh "$VPS" 'echo ok' >/dev/null 2>&1 || { echo "ERROR: Cannot SSH to $VPS"; exit 1; }
echo "VPS: reachable"
echo ""

# ── Step 1: Build locally (AMD64) ───────────────────────────
echo "=== [1/5] Building images (linux/amd64) ==="
DOCKER_DEFAULT_PLATFORM=linux/amd64 docker compose build --no-cache
echo ""

# ── Step 2: Export images ────────────────────────────────────
echo "=== [2/5] Exporting images ==="
rm -rf "$IMAGE_DIR"
mkdir -p "$IMAGE_DIR"
docker save tenshi-bot:latest | gzip > "$IMAGE_DIR/bot.tar.gz"
docker save tenshi-lavalink:latest | gzip > "$IMAGE_DIR/lavalink.tar.gz"
echo "Bot:      $(du -h "$IMAGE_DIR/bot.tar.gz" | cut -f1)"
echo "Lavalink: $(du -h "$IMAGE_DIR/lavalink.tar.gz" | cut -f1)"
echo ""

# ── Step 3: Upload to VPS ───────────────────────────────────
echo "=== [3/5] Uploading to $VPS ==="
scp "$IMAGE_DIR/bot.tar.gz" "$IMAGE_DIR/lavalink.tar.gz" "$VPS:$REMOTE_DIR/"
echo "Upload done"
echo ""

# ── Step 4: Deploy on VPS ───────────────────────────────────
echo "=== [4/5] Deploying on VPS ==="
ssh "$VPS" << 'REMOTE'
set -euo pipefail
cd ~/apps/Tenshi-Fish-Discord-bot

# Pull latest code
echo "--- Pulling code ---"
git pull

# Load new images
echo "--- Loading images ---"
gunzip -c bot.tar.gz | docker load
gunzip -c lavalink.tar.gz | docker load
rm -f bot.tar.gz lavalink.tar.gz

# Stop old containers first (prevents stale image usage)
echo "--- Stopping old containers ---"
docker compose down --remove-orphans 2>/dev/null || true

# Start new containers (--force-recreate ensures fresh images)
echo "--- Starting containers ---"
docker compose up -d --force-recreate

echo "--- Waiting for Lavalink healthcheck ---"
for i in $(seq 1 30); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' lavalink 2>/dev/null || echo "missing")
  if [ "$STATUS" = "healthy" ]; then
    echo "Lavalink: healthy (${i}0s)"
    break
  fi
  if [ "$i" = "30" ]; then
    echo "WARNING: Lavalink still not healthy after 5min"
    docker logs lavalink --tail 10
  fi
  sleep 10
done

echo ""
echo "--- Final status ---"
docker compose ps
echo ""
echo "--- Bot logs ---"
docker logs discord-bot --tail 10 2>&1 || true
REMOTE

# ── Step 5: Cleanup local temp ───────────────────────────────
echo ""
echo "=== [5/5] Cleaning up ==="
rm -rf "$IMAGE_DIR"
echo "=== Deploy complete ==="
