# /audit — report-only review battery

Follow `.claude/commands/audit.md` — the canonical workflow prose for every tool, not Claude-only
config. Text typed after `/audit` is its `$ARGUMENTS`.

Cursor has no subagents: where the workflow spawns named reviewer agents, apply each applicable
lens yourself, one at a time — the lens definitions are plain-markdown checklists under
`.claude/agents/` (the general correctness pass has no checklist file — apply it directly).
Lens selection, ranking, and the report format are unchanged.
