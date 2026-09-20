# In-game UI redesign sessions

These instructions apply to this redesign and are explicitly referenced by its tickets. Root and
package AGENTS.md contracts still apply. Read the [design contract](README.md), the selected ticket,
root AGENTS.md and CLAUDE.local.md before work.

## Where the work happens

The shell, notifications, summary bar, construction window with its papers page and residents window
are on main. Every remaining panel starts from current main:

- One ticket at a time, in its own `/worktree` off current main, on its own free preview port.
- Primary checkout: ~/Projects/vikings/open-northland, and `:5173` stays reserved for it.
- Credentials: the primary checkout's .env, read by absolute path into the process that needs it and
  never copied into a worktree.
- Use the primary content directory read-only when needed.

Verify cwd, branch and dirty state first, and preserve unfinished work. Commit only the selected
ticket's reviewed changes. Only one session should own shared HUD files at a time; inspect active
work before beginning.

Integration is rebase onto current main then fast-forward, as root instructions require. Wait for an
explicit integration instruction; do not infer it from approval of a mockup. Do not rewrite prior
session history without authorization.

## Start and handoff

Use docs/tickets/app/ingame-ui-*.md for remaining work. Start with the earliest unblocked ticket
compatible with current session context; do not restart completed design or regenerate accepted art
from scratch. Read current source because main may have advanced since the reference was written.
If a ticket spans sessions, rewrite it to the exact remaining outcome and keep its current design
artifacts discoverable in this directory; completed history belongs in commits.

Each panel follows the design-before-implementation review in README.md. Record accepted design
constraints in the shared specification, not only in conversation. A generated candidate is not
approved merely because it uses the accepted palette.

Keep index.html as an architecture mockup, separate from game code and gameplay verification. The
mockup server is `node docs/design/ingame-menu/serve.mjs 5187 /private/tmp/ingame-foundation`
(repository files first, local review inputs as fallback; 5188 belongs to the art review examples);
verify the live process and source rather than assuming it remains running. A runtime game preview
must use the repository's dev:verify flow. Track servers started by the session and follow root
cleanup policy without stopping another session's preview.

At handoff report the exact completed/remaining ticket, relevant commit, checks and live preview.
Maintain ticket dependencies and README links when deleting completed tickets.
