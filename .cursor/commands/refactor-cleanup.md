# /refactor-cleanup — behavior-preserving refactor pass

Follow `.claude/commands/refactor-cleanup.md`. Text typed after the command is its `$ARGUMENTS`
(a scope — `sim|render|app|pipeline|path|feature` — plus an optional focus).

Cursor has no subagents: where verification spawns reviewer agents on the diff, apply those lenses
inline, per `.cursor/commands/audit.md`.
