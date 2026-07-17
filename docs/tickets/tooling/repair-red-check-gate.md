# Repair the red `npm run check` gate on main

**Area:** tooling · **Origin:** /worktree static-action-ring review battery, 2026-07-17 · **Priority:** P2

`npm run check` currently **fails on a clean `main`** (verified in the primary checkout at
`317f0fd7`, unrelated to any in-flight branch). CI runs check, so main's gate is red for every
branch that rebases onto it, and the noise makes a real finding easy to miss.

Two independent errors, both reported by `biome check .`:

- `.mcp.json` — formatter diff (the `"args": ["-y", "@playwright/mcp@latest"]` array should collapse
  to one line, plus a missing trailing newline). Introduced by `317f0fd7`
  "chore: Add the Playwright MCP server to the project config", which appears to have landed without
  a format pass.
- `packages/sim/src/replay/replay.ts:4` — `lint/correctness/noUnusedImports`: several of the
  `import { type SimInputs, type Simulation, simFor } from '../simulation.js'` bindings are unused.
  Marked FIXABLE by Biome.

Distinct from `fix-biome-ignore-pattern-warning.md`, which covers a `biome.json` ignore-pattern
*warning* and records check as passing — that is no longer true.

## Scope

`npm run check:fix` resolves both mechanically. Before accepting the `replay.ts` fix, confirm the
unused imports are genuinely dead rather than a symptom of an incomplete edit — `simFor` is the
replay entry point, so an unused import there may mean a call site was dropped. If it is dead, delete
it (git history is the archive); if a caller went missing, restore the caller instead of deleting the
import.

## Verify

`npm run check` exits clean, and `npm test` still passes for `packages/sim` (`replay.ts` is covered by
the diag-bundle replay procedure pinned in `packages/app/test/diag-bundle.test.ts`).
