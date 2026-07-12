#!/usr/bin/env bash
# Runs the extraction against your own owned game copy with the standard args,
# so you don't have to remember them or fight `--` passthrough across nested npm scripts.
#
# Usage:
#   ./scripts/pipeline.sh                 # default: mod DataCnmd -> content/
#   ./scripts/pipeline.sh --out /tmp/out  # extra args are forwarded to the pipeline
set -euo pipefail

# Resolve repo root from this script's location, regardless of CWD.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Adjust GAME_DIR if your copy lives elsewhere.
GAME_DIR="${GAME_DIR:-$REPO_ROOT/../Cultures 8th Wonder}"
MOD="${MOD:-DataCnmd}"
OUT="${OUT:-content}"

cd "$REPO_ROOT"
exec npm run pipeline -- --game "$GAME_DIR" --mod "$MOD" --out "$OUT" "$@"
