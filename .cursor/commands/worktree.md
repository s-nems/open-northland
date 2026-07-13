# /worktree — execute one ticket in an isolated worktree

Follow `.claude/commands/worktree.md`. Text typed after `/worktree` is its `$ARGUMENTS`.

Cursor adaptations:

- No session-switch tool: after creating the worktree, run every subsequent command against the
  worktree path explicitly (`git -C ../opennorthland-<slug> …`, `npm --prefix ../opennorthland-<slug> …`), or
  ask the user to open the worktree folder in a new Cursor window and re-invoke
  `/worktree <ticket>` there; the worktree and branch already exist then, so skip step 1 and
  continue from step 2.
- Skip the `.claude/settings.local.json` copy — that is Claude-session state.
- Review lenses run inline, per `.cursor/commands/audit.md`.
