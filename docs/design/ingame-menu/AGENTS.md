# In-game UI redesign sessions

These instructions apply to this redesign and are explicitly referenced by its tickets. Root and
package AGENTS.md contracts still apply. Read the [design contract](README.md), the selected ticket,
root AGENTS.md and CLAUDE.local.md before work.

## Shared checkout

The user explicitly requested continuation across agent sessions in the existing worktree:

- Checkout: ~/Projects/vikings/on-ingame-ui
- Branch: design/ingame-ui
- Primary checkout: ~/Projects/vikings/open-northland
- Credentials: primary checkout's .env, never copied.

Resume this checkout; do not create a new per-panel branch/worktree, move work to main, automatically
merge a completed panel, or remove the shared checkout. Verify cwd, branch and dirty state first.
Preserve unfinished work from prior sessions. Commit only the selected task's reviewed changes.
The user approved a multi-session workflow, not concurrent uncoordinated writers. Only one session
should own shared HUD edits at a time; inspect active work/status before beginning.

An eventual integration still uses rebase onto current target then fast-forward, as root instructions
require. Wait for an explicit integration instruction; do not infer it from approval of a mockup.
Do not rewrite prior session history without authorization.

## Start and handoff

Use docs/tickets/app/ingame-ui-*.md for remaining work. Start with the earliest unblocked ticket compatible
with current session context; do not restart completed design or regenerate accepted art from scratch.
Read current source because main or another task may have advanced since the reference was written.
If a ticket spans sessions, rewrite it to the exact remaining outcome and keep its current design
artifacts discoverable in this directory; completed history belongs in commits.

Each panel follows the design-before-implementation review in README.md. Record accepted design
constraints in the shared specification, not only in conversation. A generated candidate is not
approved merely because it uses the accepted palette.

Keep index.html as an architecture mockup, separate from game code and gameplay verification.
The current mockup server uses port 5186 and serves docs/design/ingame-menu; verify the live process
and source rather than assuming it remains running. A runtime game preview must use its own free
worktree port and the repository's dev:verify flow; :5173 remains reserved for main.
Use the primary content directory read-only when needed. Track servers started by the session and
follow root cleanup policy without stopping another session's preview.

At handoff report the exact completed/remaining ticket, relevant commit, checks and live preview.
Maintain ticket dependencies and README links when deleting completed tickets. Do not merge or remove
this worktree as part of ordinary panel handoff.
