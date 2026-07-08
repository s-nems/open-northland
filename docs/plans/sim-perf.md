# Sim performance — remaining scale follow-ups (agent prompts)

Goal: land the perf doctrine's remaining follow-ups (moved here from `packages/sim/AGENTS.md`
"Scaling to thousands of units" — that file keeps rules, not roadmap). All three are deterministic,
golden-guarded refactors: an optimization may only elide provably-null work or memoize an invariant
result — the canonical pick winner must never change, and goldens must stay byte-identical (a moved
golden means behavior changed — stop and reassess).

**How to use:** run one step per fresh `/worktree` session. Steps are independent — pick by
profiling evidence, not order. When a step merges, tick its box and delete its prompt block. Delete
this file when all steps land.

- [ ] 1. Economy nearest-X scans → `TileBuckets.nearest`
- [ ] 2. Content typeId indexes for hot-loop lookups
- [ ] 3. Run the sim in a Web Worker

## Step 1 — economy nearest-X → ring search

```text
Point the economy's nearest-X scans at the landed ring-search primitive. Today the nearest
resource / store off-tile picks (packages/sim/src/systems/conflict/ai-targets.ts, ai-supply.ts —
research-time refs, re-verify) are O(idle · candidates) candidate-list scans, mitigated by the
busy-unit skip + dormancy gate + per-tick candidate lists. `TileBuckets.nearest` (systems/shared.ts)
already does the canonical (distance, id) band search — combatSystem consumes it. Migrate the
economy consumers. The ring search's winner must equal the full scan's canonical pick, so goldens
stay byte-identical — a moved golden means the pick changed. Verify with a before/after ms/tick
measurement at a few thousand settlers (throwaway timer script over dist/ — never performance.now
in src; the hygiene scan fails the build).
```

## Step 2 — content typeId indexes

```text
Replace linear `ctx.content.buildings.find(t => t.typeId === …)` (and friends: goods, jobs,
weapons) in per-tick paths with Maps keyed by typeId, built once at content load. Pure lookup
swap, determinism-neutral, goldens byte-identical. Grep the hot systems for `.find(` over content
tables first and index only what per-tick code actually calls — no speculative indexes.
```

## Step 3 — sim in a Web Worker

```text
Run the deterministic sim step off the render thread. The snapshot is already transferable
(packages/sim/test/inspect/snapshot-transferable.test.ts). This does not speed the sim; it keeps
rendering responsive during heavy ticks. App-side seam: the fixed-timestep loop posts commands in
and snapshots out; degrade to the current in-thread loop when workers are unavailable (headless
tests stay in-thread). Cross-package seam change — run the architecture-reviewer lens.
```
