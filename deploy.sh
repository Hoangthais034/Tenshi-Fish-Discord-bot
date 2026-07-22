#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "=== Pulling latest project code ==="
git pull

if [ ! -d nodelink-src ]; then
  echo "=== Cloning NodeLink v3 ==="
  git clone --branch v3 --depth 1 https://github.com/PerformanC/NodeLink.git nodelink-src
else
  echo "=== Fetching latest NodeLink v3 ==="
  cd nodelink-src
  git fetch origin v3
  git reset --hard origin/v3
  cd ..
fi

echo "=== Applying lavalinkLoad patch ==="
cd nodelink-src
git apply ../nodelink.patch
cd ..

echo "=== Building & restarting ==="
docker compose up --build -d

echo "=== Done ==="