#!/usr/bin/env bash
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USER_URL="${1:?Usage: collect_user.sh <douyin-user-url> [account] [output-dir]}"
ACCOUNT="${2:-default}"
OUT="${3:-./output/collection}"
DB="$OUT/douyin_collection.sqlite"

set +e
node "$SKILL_DIR/douyin-video.js" check-login --account "$ACCOUNT"
LOGIN_STATUS=$?
set -e

if [[ "$LOGIN_STATUS" -ne 0 && "$LOGIN_STATUS" -ne 2 ]]; then
  exit "$LOGIN_STATUS"
fi

node "$SKILL_DIR/douyin-video.js" collect-user "$USER_URL" --account "$ACCOUNT" --db "$DB" -o "$OUT" --limit 100
