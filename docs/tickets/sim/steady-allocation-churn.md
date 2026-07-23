# Reduce the sim's steady per-tick allocation churn

**Area:** sim · **Priority:** P2

Measured in real Chrome (Apple GPU, `?map=blekiny_nurt` with active AI combat, 8 s of 100 ms
`performance.memory` samples plus a CDP allocation-sampling profile that keeps GC-collected
samples): the app steadily allocates ~55 MB/s at ANY zoom, driving ~2.5 GC heap drops per second.
The render/app side was already cut (the old zoom-out ticket - zoomed-out churn now equals the
zoom-1 rate); what remains is sim-side, per tick (~4.5 MB per 12 Hz tick), dominated by:

- **World query iteration** - `World.query` frames plus iterator-result churn (`next`) were the two
  largest sites (~180 MB over the 8 s window). Hot callers: `tribeUnlockEnabled` via
  `productionSystem`/`recipeUnlocked`, `navigationLimitFor` (jobs + AI planner).
- **Spatial search** - `NodeBuckets` construction + `indexNodesFor` + `nearest`
  (`systems/spatial.js`, ~90 MB), mostly under `combatSystem`/`engageCombatant` and the AI planner;
  `nodesOf` (`conflict/combat.js`) adds ~38 MB.
- **Snapshot cloning** - `takeSnapshot`/`cloneEntity`/`clonePlain` (~75 MB): every non-scenery
  entity re-clones each tick; with hundreds of settlers plus animals that is the third pillar.

## Scope

Profile with the same procedure (allocation sampling with
`includeObjectsCollectedByMajorGC/MinorGC: true` - the default live-only profile hides exactly this
garbage) and cut the dominant sites, e.g. reusable query/iteration paths, reused spatial scratch
structures per tick, and a cheaper snapshot story for high-churn components. Sim purity and
determinism rules apply; per-tick cost must keep scaling with active work.

## Verify

Repeat the A/B measurement (8 s of 100 ms `performance.memory.usedJSHeapSize` samples, summing
positive increments, on a busy map); the steady rate should drop by at least half and the perf
overlay's `pamięć` sawtooth should flatten correspondingly. `npm run bench:sim` before/after for
tick-cost regressions.
