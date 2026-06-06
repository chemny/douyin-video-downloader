#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LINK="${1:?Usage: single_download.sh <douyin-share-link> [output-dir]}"
OUT="${2:-./output/single}"

node "$SKILL_DIR/douyin-video.js" info "$LINK" --cover-size medium
node "$SKILL_DIR/douyin-video.js" download "$LINK" -o "$OUT" --quality best --cover-size medium
node "$SKILL_DIR/douyin-video.js" audio "$LINK" -o "$OUT"
