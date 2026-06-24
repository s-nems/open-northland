# Tech debt & deferred reworks

Tracked, deliberately-deferred improvements — the "propose big" half of the `/reflect` loop. Each
entry is a rework too large to land safely in a single small/reversible commit, so it is written up
here instead of executed. Advance or prune entries as they are addressed.

The **Reflection log** at the bottom is the git-native anchor `/iterate` reads to judge when the
last reflection happened.

## Deferred proposals

### 1. Finish splitting the `systems/` god-module

- **Problem.** `packages/sim/src/systems/index.ts` is the project's churn hotspot — it was edited in
  almost every recent feature commit and grew to ~820 lines holding five real systems
  (`aiSystem` + its `atomicPlanner`/`navigationPlanner`, `pathfindingSystem`, `atomicSystem`,
  `productionSystem`), all their private helpers, the dozen not-yet-implemented stub systems, the
  `todo()` factory, and `SYSTEM_ORDER`. Every new slice lands here, so the file is a magnet for
  merge collisions and the review surface for any one mechanic is the whole module.
- **Done so far (the small first step, this pass).** The shared `System`/`SystemContext` types moved
  to `systems/context.ts`, and `movementSystem` (the one system with **zero** shared helpers) moved
  to `systems/movement.ts`. `index.ts` re-exports both, so the public `systems` namespace and the
  test imports are unchanged. This establishes the no-import-cycle layout (`context.ts` is the leaf
  every per-system file imports `System` from, never the barrel) and the per-system-file pattern.
- **Change (the deferred remainder).** Split each remaining real system into its own file under
  `systems/`, with a small shared-helper module to break the cross-system dependencies:
  - `systems/shared.ts` — the genuinely cross-system helpers: `stockCapacity` (used by the ai store
    scan, the atomic `pileup`, and production's `canStartCycle`/`depositOutputs`) and `inRange`
    (used by the ai navigation planner and the pathfinding system).
  - `systems/ai.ts` — `aiSystem` + `atomicPlanner` + `navigationPlanner` + the ai-only helpers
    (`nearestHarvestableFor`, `nearestStoreFor`, `jobAtomics`, `entityCell`, `manhattan`,
    `atomicDuration`, `startAtomic`, and the `PILEUP_ATOMIC_ID`/`DEFAULT_ATOMIC_DURATION`/
    `EMPTY_ATOMICS` constants).
  - `systems/pathfinding.ts` — `pathfindingSystem` + `resolvePath` + `PATHFINDING_BUDGET_PER_TICK`.
    (Note: a `packages/sim/src/pathfinding.ts` already holds the A\* core — the new file is in the
    `systems/` directory, but consider naming it to avoid the eyeball collision.)
  - `systems/atomic.ts` — `atomicSystem` + `applyEffect` + `harvestFromNode`/`addCarry`/
    `pileupIntoStore` + `HARVEST_YIELD`.
  - `systems/production.ts` — `productionSystem` + `recipeOf`/`canStartCycle`/`consumeInputs`/
    `depositOutputs`.
  - `systems/stubs.ts` — the `todo()` factory and the not-yet-implemented placeholder systems.
    (As a stub becomes real it graduates to its own file; the end-state is `index.ts` = barrel +
    `SYSTEM_ORDER` only.)
  - `systems/index.ts` — shrinks to a barrel that re-exports everything and defines `SYSTEM_ORDER`.
- **Payoff.** Each slice lands in (and is reviewed as) its own file; far fewer merge collisions on
  the hot module; the review surface for one mechanic is one file; `SYSTEM_ORDER` and the public
  surface stay legible. Directly serves the "agent-legible" architecture goal.
- **Risk / size.** Mechanical and **behavior-preserving** — the golden state-hash + atomic-trace
  tests are the safety net (they must stay byte-identical; a moved golden means a real change crept
  in). But it is a multi-file move that also touches every `systems/index.ts` test import, and it
  requires the deliberate shared-helper untangling above (so it isn't a blind copy-paste). Too large
  to do unattended in one reflection commit; best done as one focused, reviewed PR, or as a short
  series of per-system extraction commits each proven green.

### 2. Compact `docs/ROADMAP.md` so the live target stands out

- **Problem.** `ROADMAP.md` is 542 lines — ~4× any other doc. The stated "current target" (Phase 2)
  is buried under ~290 lines of completed Phase 0/1 checkboxes, many carrying dense multi-line
  "Hands-on:" verification notes. A reader (or agent) can no longer see "what's the smallest next
  step" without scrolling past a wall of done work.
- **Change.** Collapse the *completed* sub-items of Phase 0 and Phase 1 to crisp one-line summaries
  so the unchecked live items dominate. The "Hands-on:" notes are a deliberate clean-room
  verification record and should be **preserved, not deleted** — either kept (more tersely) or moved
  to a dedicated `docs/PIPELINE-NOTES.md` / left to the per-feature commit messages (which already
  carry them). Decide the home with the author before cutting.
- **Payoff.** The roadmap returns to its job: the top unchecked milestone is the obvious next target;
  `/iterate` reads it more cheaply.
- **Risk / size.** Doc-only and reversible (git keeps every word), but judgment-heavy: deciding what
  detail to keep vs. relocate is the work, and the verification notes are valued — so it wants author
  buy-in on where they land rather than an unattended bulk delete.

## Reflection log

- **2026-06-24** — Surveyed history/churn, code health, docs, and roadmap. Highest-leverage finding:
  `systems/index.ts` is a growing god-module (the churn hotspot). Landed the small first step —
  extracted `System`/`SystemContext` into `systems/context.ts` and `movementSystem` into
  `systems/movement.ts` (behavior-preserving; golden hashes unchanged; 269 tests + check + build
  green). Proposed the full `systems/` split (#1) and a `ROADMAP.md` compaction (#2) as the deferred
  big reworks. Next `/iterate` roadmap step is unchanged: Phase 2's "minimal carrier moving goods
  between store and workplace".
