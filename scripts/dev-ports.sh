#!/usr/bin/env bash
# List listening TCP servers with the directory each one runs from, so you can
# tell the primary checkout's dev server apart from worktree agents' servers.
#
# Usage: scripts/dev-ports.sh        # node processes only (vite dev servers)
#        scripts/dev-ports.sh --all  # every listening TCP server
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# :5173 is reserved for the primary checkout; worktree agents must serve on
# another port (see .claude/commands/worktree.md).
PRIMARY_PORT=5173
PRIMARY_ROOT="$(dirname "$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir)")"

show_all=false
case "${1:-}" in
  -a | --all) show_all=true ;;
esac

# -F emits one field per line (p=pid, c=command, n=socket name); capture first
# so an empty result (lsof exits 1) doesn't trip pipefail.
listeners="$(lsof -nP -iTCP -sTCP:LISTEN -Fpcn 2>/dev/null || true)"

printf '%-6s %-7s %-12s %s\n' PORT PID COMMAND CWD

pid='' cmd='' seen=' '
printf '%s\n' "$listeners" | while IFS= read -r line; do
  case "$line" in
    p*) pid="${line#p}" ;;
    c*) cmd="${line#c}" ;;
    n*)
      if ! $show_all && [ "$cmd" != node ]; then continue; fi
      # A server bound on IPv4+IPv6 emits two n lines -> dedupe by pid:port.
      port="${line##*:}"
      case "$seen" in *" $pid:$port "*) continue ;; esac
      seen="$seen$pid:$port "
      cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
      note=''
      case "$cwd" in
        "$PRIMARY_ROOT" | "$PRIMARY_ROOT"/*) note='  <- primary checkout' ;;
        *)
          if [ "$port" = "$PRIMARY_PORT" ]; then
            note='  !! holds the primary port but is NOT the primary checkout'
          fi
          ;;
      esac
      printf '%-6s %-7s %-12s %s%s\n' "$port" "$pid" "$cmd" "${cwd:-?}" "$note"
      ;;
  esac
done
