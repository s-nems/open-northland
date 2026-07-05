#!/usr/bin/env bash
# Full reset of the primary dev server: kill whatever holds :5173, clear vite's
# dependency cache, then start vite bound strictly to :5173 -- the fresh server
# either owns the primary port or fails loudly (it never silently drifts to
# :5174 while a stale server keeps answering on :5173).
#
# Primary-checkout only: :5173 is reserved for it; worktree agents serve on
# other ports (see .claude/commands/worktree.md).
#
# Usage: scripts/dev-reset.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PRIMARY_PORT=5173
KILL_WAIT_TICKS=25 # x 0.2s = 5s of graceful-shutdown grace before SIGKILL

# In a linked worktree the per-worktree git dir differs from the shared one --
# refuse to claim the primary port from there.
if [ "$(git -C "$ROOT" rev-parse --path-format=absolute --git-dir)" != \
  "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)" ]; then
  echo "error: this checkout is a linked worktree; :$PRIMARY_PORT is reserved for the primary checkout." >&2
  echo "Serve this worktree on another port instead (see .claude/commands/worktree.md)." >&2
  exit 1
fi

pids="$(lsof -t -iTCP:"$PRIMARY_PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$pids" ]; then
  for pid in $pids; do
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    echo "killing pid $pid on :$PRIMARY_PORT (cwd: ${cwd:-?})"
    kill "$pid" 2>/dev/null || true
  done
  tick=0
  while [ "$tick" -lt "$KILL_WAIT_TICKS" ] && lsof -t -iTCP:"$PRIMARY_PORT" -sTCP:LISTEN >/dev/null 2>&1; do
    sleep 0.2
    tick=$((tick + 1))
  done
  survivors="$(lsof -t -iTCP:"$PRIMARY_PORT" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$survivors" ]; then
    echo "still listening after graceful kill; sending SIGKILL: $survivors"
    # shellcheck disable=SC2086 -- word-splitting the pid list is intended
    kill -9 $survivors 2>/dev/null || true
  fi
else
  echo "nothing listening on :$PRIMARY_PORT"
fi

# Vite's pre-bundled dependency cache survives restarts; a full reset removes
# it so the fresh server rebuilds everything from the current tree.
for cache in "$ROOT/packages/app/node_modules/.vite" "$ROOT/node_modules/.vite"; do
  if [ -d "$cache" ]; then
    rm -rf "$cache"
    echo "cleared $cache"
  fi
done

cd "$ROOT"
echo "starting fresh dev server on :$PRIMARY_PORT (strict)..."
exec npm run dev --workspace @vinland/app -- --port "$PRIMARY_PORT" --strictPort
