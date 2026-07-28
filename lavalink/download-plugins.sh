#!/bin/bash
set -euo pipefail

YOUTUBE_PLUGIN_VERSION="1.18.2"
PLUGIN_DIR="$(dirname "$0")/plugins"
mkdir -p "$PLUGIN_DIR"

echo "Downloading youtube-source plugin v${YOUTUBE_PLUGIN_VERSION}..."
curl -sL -o "$PLUGIN_DIR/youtube-plugin.jar" \
  "https://github.com/lavalink-devs/youtube-source/releases/download/${YOUTUBE_PLUGIN_VERSION}/youtube-plugin-${YOUTUBE_PLUGIN_VERSION}.jar"

echo "Done."