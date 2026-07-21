# /worktree: execute one isolated task

Follow `.claude/commands/worktree.md` and treat text after `/worktree` as `$ARGUMENTS`.

Cursor adaptations:

- Run commands against the derived worktree path explicitly, or ask the user to open that path in a
  new Cursor window and resume at step 2.
- Do not copy `.claude/settings.local.json`; it is local session state.
- Apply review checklists inline through `.cursor/commands/audit.md`.
