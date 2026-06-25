# Tech debt & deferred reworks

Tracked, deliberately-deferred improvements — the "propose big" half of the `/reflect` loop. Each
entry is a rework too large to land safely in a single small/reversible commit, so it is written up
here instead of executed. Advance or prune entries as they are addressed.

The **Reflection log** at the bottom is the git-native anchor `/iterate` reads to judge when the
last reflection happened.

For small, hard-won *gotchas* (not reworks), see [LESSONS.md](LESSONS.md) instead; for the live
feature plan, see [ROADMAP.md](ROADMAP.md).

## Deferred proposals

### 1. Finish splitting the `systems/` god-module — **DONE**

- **Status.** Complete as of `routing.ts` extraction (golden `7f89b94d` byte-identical throughout).
  `index.ts` is now the barrel + `SYSTEM_ORDER` only (~70 lines); every real system lives in its own
  file under `systems/`. Kept here as the executed record; prune on the next reflection.
- **Problem.** `packages/sim/src/systems/index.ts` was the project's churn hotspot — it was edited in
  almost every recent feature commit and grew to ~820 lines holding five real systems
  (`aiSystem` + its `atomicPlanner`/`navigationPlanner`, `pathfindingSystem`, `atomicSystem`,
  `productionSystem`), all their private helpers, the dozen not-yet-implemented stub systems, the
  `todo()` factory, and `SYSTEM_ORDER`. Every new slice landed here, so the file was a magnet for
  merge collisions and the review surface for any one mechanic was the whole module.
- **Done so far.** The shared `System`/`SystemContext` types moved to `systems/context.ts`, and
  `movementSystem` (the one system with **zero** shared helpers) moved to `systems/movement.ts`.
  Then the `todo()` factory + the ten not-yet-implemented placeholder systems moved to
  `systems/stubs.ts` (the lowest-risk slice — no shared helpers, only the `System` type). Next the
  **shared-helper leaf landed** — `systems/shared.ts` now holds the three genuinely cross-system
  helpers (`stockCapacity`, `recipeOf`, `inRange`) — and `productionSystem` moved to
  `systems/production.ts` (with its production-only `canStartCycle`/`consumeInputs`/`depositOutputs`),
  importing the shared helpers from the leaf. `index.ts` re-exports all of them, so the public
  `systems` namespace and the test imports are unchanged (all tests import through the barrel). This
  establishes the no-import-cycle layout (`context.ts` + `shared.ts` are the leaves every per-system
  file imports from, never the barrel or each other) and the per-system-file pattern. `atomicSystem`
  then moved to `systems/atomic.ts` (with its `applyEffect`/`harvestFromNode`/`pickupFromStore`/
  `pileupIntoStore`/`addCarry` helpers + `HARVEST_YIELD`), importing only `stockCapacity` from the
  leaf; the golden `7f89b94d` stayed byte-identical. `aiSystem` then moved to `systems/ai.ts` (with
  `atomicPlanner`/`navigationPlanner` + the ai-only helpers `nearestHarvestableFor`/`nearestStoreFor`/
  `nearestWorkplaceOutput`/`jobAtomics`/`entityCell`/`manhattan`/`atomicDuration`/`startAtomic` + the
  `PICKUP_ATOMIC_ID`/`PILEUP_ATOMIC_ID`/`CARRY_LOAD`/`DEFAULT_ATOMIC_DURATION`/`EMPTY_ATOMICS`
  constants), importing `inRange`/`recipeOf`/`stockCapacity` from the leaf; the golden `7f89b94d`
  stayed byte-identical. Finally `pathfindingSystem` moved to `systems/routing.ts` (named to avoid the
  eyeball collision with the A* core in `../pathfinding.ts` that it consumes) — with `resolvePath` +
  `PATHFINDING_BUDGET_PER_TICK`, importing `inRange` from the leaf; the golden `7f89b94d` stayed
  byte-identical. **`index.ts` is now the barrel + `SYSTEM_ORDER` only — the split is complete.**
- **Change (the deferred remainder).** Split each remaining real system into its own file under
  `systems/`, with a small shared-helper module to break the cross-system dependencies:
  - `systems/shared.ts` — the genuinely cross-system helpers: `stockCapacity` (used by the ai store
    scan, the atomic `pileup`, and production's `canStartCycle`/`depositOutputs`), `recipeOf` (used by
    the ai haul scan and production), and `inRange` (used by the ai navigation planner and the
    pathfinding system). **(Done — landed alongside the production extraction.)**
  - `systems/ai.ts` — `aiSystem` + `atomicPlanner` + `navigationPlanner` + the ai-only helpers
    (`nearestHarvestableFor`, `nearestStoreFor`, `nearestWorkplaceOutput`, `jobAtomics`, `entityCell`,
    `manhattan`, `atomicDuration`, `startAtomic`, and the `PICKUP_ATOMIC_ID`/`PILEUP_ATOMIC_ID`/
    `CARRY_LOAD`/`DEFAULT_ATOMIC_DURATION`/`EMPTY_ATOMICS` constants). **(Done — landed; golden
    `7f89b94d` unchanged.)**
  - `systems/routing.ts` — `pathfindingSystem` + `resolvePath` + `PATHFINDING_BUDGET_PER_TICK`
    (named `routing.ts`, not `pathfinding.ts`, to avoid the eyeball collision with the A\* core in
    `../pathfinding.ts` that it consumes). **(Done — landed; golden `7f89b94d` unchanged.)**
  - `systems/atomic.ts` — `atomicSystem` + `applyEffect` + `harvestFromNode`/`pickupFromStore`/
    `addCarry`/`pileupIntoStore` + `HARVEST_YIELD`. **(Done — landed; golden `7f89b94d` unchanged.)**
  - `systems/production.ts` — `productionSystem` + `canStartCycle`/`consumeInputs`/`depositOutputs`
    (`recipeOf` graduated to `shared.ts` — the ai also uses it). **(Done — landed; golden `7f89b94d`
    unchanged.)**
  - `systems/stubs.ts` — the `todo()` factory and the not-yet-implemented placeholder systems.
    **(Done — landed; see "Done so far" above.)** As a stub becomes real it graduates to its own
    file; the end-state is `index.ts` = barrel + `SYSTEM_ORDER` only.
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

### 3. Edit-time determinism guard (Claude Code hook)

- **Problem.** The determinism contract (no `Math.random`/`Date.now`/`new Date`/`performance.now` in
  `sim`) is only checked when an agent runs `npm test` or CI — a violation introduced mid-edit isn't
  surfaced until the next test run.
- **Change.** A `PostToolUse` hook on `Edit|Write` matching `packages/sim/src/**.ts` that re-checks
  the four forbidden patterns and feeds violations back via exit 2.
- **Payoff.** Instant, deterministic feedback at the moment a violation is introduced — a
  verification oracle the model can't forget.
- **Risk / size.** Small but friction-prone, and **deliberately deferred**: `hygiene.test.ts` already
  enforces this in `npm test` + CI, and `/iterate` runs `npm test` before every commit, so a bad
  pattern can't reach a commit today — the hook only buys ~1–3s earlier feedback at the cost of a
  `vitest` cold-start on *every* sim edit (+ a `jq` dependency). If adopted, implement as a
  near-instant `grep` guard mirroring `test/hygiene.test.ts:13-18`, not a vitest run (but that
  duplicates the authoritative test and can drift). `.claude/` is gitignored, so this is local tooling.

### 4. Parallel git-worktree iterations (supervisor)

- **Problem.** `iterate-supervisor` runs strictly sequentially (one commit to `main` per iteration);
  provably-independent work can't overlap.
- **Change.** For independent roadmap items, fan out N subagents on separate `git worktree`s, then
  merge clean ones (`git merge-tree` conflict check), gated behind a "remaining items touch
  non-overlapping files" heuristic.
- **Payoff.** Wall-clock speedup for independent batches.
- **Risk / size.** Medium. Fights the bisectable one-commit-per-iteration model and our mostly
  *dependent* roadmap (each Phase-2 step builds on the last); merge-conflict resolution is its own
  logic. Only worth it once a genuinely-independent batch exists.

### 5. Spec-first / dependency-aware step picking (iterate)

- **Problem.** `/iterate` picks the *locally* smallest next step; it models neither roadmap
  dependencies nor a spec gate for larger items.
- **Change.** Model the roadmap as a dependency DAG (pick the leaf that unblocks the most), and/or a
  spec-first gate for non-trivial items.
- **Payoff.** Globally-greedy step order; fewer mid-build pivots.
- **Risk / size.** Medium. The roadmap already serves as a lightweight spec and "smallest step" leans
  ReAct deliberately; heavyweight gating risks over-planning. Revisit if step selection starts to thrash.

### 6. Community / multi-tool docs

- **Problem.** No `CONTRIBUTING.md`, `.github/` PR+issue templates, or `AGENTS.md` (the cross-tool
  agent-instructions convention) — fine while solo + agent-driven, a gap if the project opens up.
- **Change.** Add them when the project takes human contributors or multiple agent tools. Legal
  posture is already covered (`README.md` Legal, `docs/SOURCES.md`, `CLAUDE.md`).
- **Payoff.** Lowers the contribution barrier; one canonical agent-instructions file across tools.
- **Risk / size.** Small but premature now (deferred by decision).

## Reflection log

- **2026-06-24** — Surveyed history/churn, code health, docs, and roadmap. Highest-leverage finding:
  `systems/index.ts` is a growing god-module (the churn hotspot). Landed the small first step —
  extracted `System`/`SystemContext` into `systems/context.ts` and `movementSystem` into
  `systems/movement.ts` (behavior-preserving; golden hashes unchanged; 269 tests + check + build
  green). Proposed the full `systems/` split (#1) and a `ROADMAP.md` compaction (#2) as the deferred
  big reworks. Next `/iterate` roadmap step is unchanged: Phase 2's "minimal carrier moving goods
  between store and workplace".
- **2026-06-24** (agent-tooling pass) — Reviewed the `/iterate`+`/reflect`+supervisor skills against
  external practice and improved project health for agentic use: added the compounding-memory channel
  [LESSONS.md](LESSONS.md) (the loop already discovers gotchas that died in a gitignored report) and
  wired `/iterate` to read/write it + `/reflect` to curate it (local skill tooling); split the sim &
  pipeline contracts into per-package `CLAUDE.md` files (root keeps the crisp golden rules + a
  pointer); polished the self-validation docs (TESTING run/debug subsection, ROADMAP done-vs-pending
  clarity + archived solved risks, DATA-FORMAT IR-versioning policy, ECS atomic example); expanded the
  local permission allowlist + granted read access to the two reference siblings; added
  `handsOnEvidence`/`lesson` fields to the supervisor closeout. Logged proposals #3–#6 (the
  determinism hook deferred after weighing per-edit friction vs. the existing `npm test`/CI gate).
