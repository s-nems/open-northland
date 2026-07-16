#!/usr/bin/env bash
# Runs the extraction against your own owned game copy with the standard args,
# so you don't have to remember them or fight `--` passthrough across nested npm scripts.
#
# Usage:
#   ./scripts/pipeline.sh                 # mod auto-detected in the game folder -> content/
#   ./scripts/pipeline.sh --out /tmp/out  # extra args are forwarded to the pipeline
#   MOD_ROOT=/path/to/CnMod ./scripts/pipeline.sh  # mod unpacked outside the game folder
set -euo pipefail

# Resolve repo root from this script's location, regardless of CWD.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Adjust GAME_DIR if your copy lives elsewhere.
GAME_DIR="${GAME_DIR:-$REPO_ROOT/../Cultures 8th Wonder}"
OUT="${OUT:-content}"

cd "$REPO_ROOT"
if [[ -n "${MOD_ROOT:-}" ]]; then
  exec npm run pipeline -- --game "$GAME_DIR" --mod-root "$MOD_ROOT" --out "$OUT" "$@"
fi
exec npm run pipeline -- --game "$GAME_DIR" --out "$OUT" "$@"
