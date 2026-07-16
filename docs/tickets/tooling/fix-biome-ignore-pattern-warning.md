# Remove the obsolete Biome folder-ignore pattern

**Area:** tooling · **Origin:** movement calibration verification, 2026-07-15 · **Priority:** P3

`npm run check` passes but Biome 2.5.3 warns that `!.claude/**` is an obsolete folder-ignore form in
`biome.json`. The replacement must preserve the intended `.claude/worktrees/**` handling rather than
silencing the warning by accidentally changing which worktree files Biome scans.

## Scope

Re-verify Biome's ordered `files.includes` semantics, replace the obsolete folder pattern with the
supported form, and keep the current inclusion or exclusion of `.claude/worktrees` explicit.

## Verify

Run `npm run check` and confirm it passes without `lint/suspicious/useBiomeIgnoreFolder` or newly scanned
worktree findings.
