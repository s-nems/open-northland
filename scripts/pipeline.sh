#!/usr/bin/env bash
# Runs the extraction against the unpacked CulturesNation mod with the standard args, so you don't
# have to remember them or fight `--` passthrough across nested npm scripts.
#
# Usage:
#   ./scripts/pipeline.sh                            # ../CNMod-1.3.2 -> content/
#   ./scripts/pipeline.sh --out /tmp/out             # extra args are forwarded to the pipeline
#   MOD_ROOT=/path/to/CnMod ./scripts/pipeline.sh    # mod unpacked elsewhere
set -euo pipefail

# Resolve repo root from this script's location, regardless of CWD.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MOD_ROOT="${MOD_ROOT:-$REPO_ROOT/../CNMod-1.3.2}"
OUT="${OUT:-content}"

cd "$REPO_ROOT"
exec npm run pipeline -- --mod-root "$MOD_ROOT" --out "$OUT" "$@"
