# Trim the remaining overgrown comments in packages/sim

**Area:** sim · **Origin:** /trim-comments sweep, branch docs/trim-sim-comments, 2026-07-14 · **Priority:** P3

The first `/trim-comments` pass over `packages/sim` took the ten worst files by comment-line count
(1169 → 852 comment lines) down to the "Comments are budgeted prose" rule in `AGENTS.md`. The files
below were ranked next and were not touched — the run is capped at ~10 files.

The recurring offenders that pass found, useful as a grep list for the next run:

- A `Determinism: … no RNG, no wall-clock` paragraph restating the package contract on every export
  (worst in `readviews/hud.ts`, `progression/unlocks.ts`) — the sim contract already mandates it; only
  a *specific* non-obvious note earns a line (e.g. "sorted, so declaration order can't leak").
- One shared rationale paragraph copy-pasted per constant (`lifecycle/needs.ts` had it four times) —
  state it once above the group.
- Sibling/ordinal narration ("the fourth derived view after X", "the last extracted field to get a
  reader") — history of how the code got here.
- `source-basis:` restating a citation the first line already gave.

## Scope

Comment-only pass — no code, name, type, import, or formatting changes. Ranked by comment lines:

| cmt | code | path |
|----:|-----:|------|
| 142 | 142 | `systems/conflict/combat.ts` |
| 137 | 139 | `systems/agents/atomic.ts` |
| 127 | 163 | `nav/terrain/graph.ts` |
| 124 | 161 | `systems/footprint/placement.ts` |
| 122 | 159 | `nav/pathfinding.ts` |
| 121 | 126 | `systems/agents/effects-goods/harvest.ts` |
| 112 | 174 | `simulation.ts` |
| 112 | 105 | `systems/agents/ai.ts` |
| 107 |  62 | `systems/movement/movement.ts` |
| 106 | 107 | `core/events.ts` |

Keep units, invariants, source basis (as a short parenthetical), named approximations, and
why-not-the-obvious-way. `systems/readviews/tribes/animals.ts` (123/64) ranks high on density but was
deliberately left alone: every line carries a distinct param name, source basis, or default — re-check
before trimming it rather than cutting to hit a ratio.

## Verify

`npm run check`, `npm test`, `npm run build`. Goldens must not move — a moved golden means code was
touched; revert that hunk. Prove the diff is comment-only by stripping comments from `git show
main:<file>` and the working copy and diffing the remainder; they must be identical.
