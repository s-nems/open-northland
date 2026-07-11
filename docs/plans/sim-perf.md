# Sim performance — remaining scale follow-ups (agent prompts)

Goal: land the perf doctrine's remaining follow-ups (moved 2026-07-08 from `packages/sim/AGENTS.md`
"Scaling to thousands of units" — that file keeps rules, not roadmap). All three are deterministic,
golden-guarded refactors: an optimization may only elide provably-null work or memoize an invariant
result — the canonical pick winner must never change, and goldens must stay byte-identical (a moved
golden means behavior changed — stop and reassess).

**How to use:** run one step per fresh `/worktree` session. Steps are independent — pick by
profiling evidence, not order. When a step merges, tick its box and delete its prompt block. Delete
this file when all steps land.

- [ ] 1. Economy nearest-X scans → `NodeBuckets.nearest`
- [x] 2. Content typeId indexes for hot-loop lookups
- [ ] 3. Run the sim in a Web Worker

Progress — Step 2 (2026-07-08, branch refactor/sim-rework): landed as `core/content-index.ts` —
WeakMap-memoized O(1) Maps over a ContentSet (buildings/goods/jobs/tribes/vehicles/armor/
jobExperience/animals/atomicAnimations/gatheringPipeline/landscapeGfx + precomputed worker-job
and job-atomic sets, the last-wins `setatomic` binding tables, and the first-wins weapon tables).
Each table reproduces the duplicate-key semantics of the exact scan it replaced, so every pick is
unchanged; verified by the full suite (goldens byte-identical) plus determinism/perf/quality/
architecture review lenses. Source basis n/a (pure lookup swap).

## Step 1 — economy nearest-X → ring search

```text
Point the economy's nearest-X scans at the landed ring-search primitive. Today the nearest
resource / store off-tile picks (packages/sim/src/systems/agents/ai-targets.ts, ai-supply.ts) are
O(idle · candidates) candidate-list scans, mitigated by the busy-unit skip + dormancy gate +
per-tick candidate lists. `NodeBuckets.nearest` (systems/spatial.ts) already does the canonical
(distance, entity-id) band search — combatSystem consumes it.

CORRECTED RESEARCH FACT (2026-07-08, refactor/sim-rework analysis): a PLAIN migration moves
goldens. The economy scans measure to each candidate's INTERACTION cell (a building's door, a
resource's work cell) and tie-break by CELL id — not the candidate's own tile and entity id that
NodeBuckets.nearest uses — and resourceWorkCell / the blocked-anchor pile fallback are
SEEKER-dependent (the effective cell differs per seeker), so those candidates cannot be
pre-bucketed at all. A golden-safe migration needs an interaction-tile-bucketed ring variant with
a (distance, cellId, entityId) pick for the seeker-independent scans (nearestTemple, the
building-only store scans), a bounded radius + linear fallback (an unbounded ring miss walks the
whole map), and must leave the seeker-dependent scans linear. Alternatively land the provably
winner-identical interim win first: a per-tick hasDeliverableSink(goodType) memo replacing the
null-tests of the nested nearestStoreFor calls (ai-targets.ts nearestWorkplaceOutput,
ai-supply.ts workplaceOutputToHaul) — kills the O(stockpiles²) carrier path without touching any
pick. Goldens must stay byte-identical; verify with a before/after ms/tick measurement at a few
thousand settlers (throwaway timer script over dist/ — never performance.now in src).
```

## Step 3 — sim in a Web Worker

```text
Run the deterministic sim step off the render thread. The snapshot is already transferable
(packages/sim/test/inspect/snapshot-transferable.test.ts). This does not speed the sim; it keeps
rendering responsive during heavy ticks. App-side seam: the fixed-timestep loop posts commands in
and snapshots out; degrade to the current in-thread loop when workers are unavailable (headless
tests stay in-thread). Cross-package seam change — run the code-reviewer lens with architecture weight.
```
