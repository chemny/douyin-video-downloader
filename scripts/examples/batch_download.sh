#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB="${1:?Usage: batch_download.sh <sqlite-db> [output-dir]}"
OUT="${2:-./output/downloads}"

node "$SKILL_DIR/douyin-video.js" db-download-batch \
  --db "$DB" \
  -o "$OUT/videos" \
  --quality best \
  --cover-size medium \
  --delay-seconds 5 \
  --confirm-every 10 \
  --download-limit 100

node "$SKILL_DIR/douyin-video.js" db-download-audio-batch \
  --db "$DB" \
  -o "$OUT/audios" \
  --delay-seconds 5 \
  --download-limit 100
