# Stop biome from silently checking 0 files inside `.claude/worktrees/`

**Area:** repo tooling (`biome.json`) · **Origin:** /trim-comments render sweep, 2026-07-14 · **Priority:** P2

`npm run check` is a **silent no-op inside any `/worktree` session**, which makes the project's primary
lint/format gate useless exactly where agents do their work.

Cause: `biome.json` has `"files": { "includes": ["**", "!**/.claude"] }`. `EnterWorktree` creates
worktrees at `<repo>/.claude/worktrees/<name>/`, so the worktree root itself matches `!**/.claude` and
biome excludes the entire tree. Observed from a worktree:

```
$ npm run check
Checked 0 files in 7ms.
× No files were processed in the specified paths.
i These paths were provided but ignored:
- .
```

Exit code is 1 here, but the failure reads as a configuration complaint rather than "your gate did not
run", and the 0-files line is easy to skim past. During this sweep ten subagents each independently
reported "biome check passes clean" — every one of those greens was this no-op. The real check (run with
the exclusion lifted) processed 86 files.

The `!**/.claude` entry is presumably meant to skip local agent tooling (`.claude/settings.json`,
skills, hooks), not worktrees — which are real checkouts of this repo and should be gated normally.

## Scope

- Narrow the exclusion so it skips agent tooling but not worktree checkouts. Anchoring it to the repo
  root (`"!.claude"`, or `"!.claude/**"` minus `worktrees`) is the likely fix — verify against biome
  2.5's glob semantics rather than assuming, since `**/.claude` vs `.claude` anchoring is the whole bug.
- Confirm `npm run check` processes a non-zero file count from *both* the main checkout and a worktree
  under `.claude/worktrees/`.
- Consider whether `npm test` deserves the same look: a fresh worktree has no `node_modules`/`dist`, so
  tests fail on unresolved workspace packages until `npm install && npm run build` are run there. If
  that is expected, say so in `AGENTS.md` under Commands; if not, file separately.

## Verify

From a worktree created by `/worktree`: `npm run check` reports a non-zero "Checked N files" and passes.
From the main checkout: same, with no newly-ignored paths. Sanity-check that `.claude/settings.json` and
other local agent tooling are still excluded.
