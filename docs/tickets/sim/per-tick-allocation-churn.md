# Stop shared scan helpers from allocating per candidate

**Area:** sim · **Priority:** P3

Garbage collection grows with the settlement. On `magiczny_las_12_players` with 13 AI seats, the 60k
`bench:map` run (busy machine) paused 0.4 s for GC in its first 5,000-tick window (708 settlers) and
2.1 s in its last (1011 settlers), 12.5k collections and 14 s in all, longest pause 59 ms. The quiet
profile from the 40k checkpoint paused 1.15 s over 4,200 ticks (997 collections, longest 16.9 ms), and
`(garbage collector)` is 1.5-2.1% self in every profile. A sampling heap profile that keeps collected
objects (`node:inspector` `HeapProfiler.startSampling` with `includeObjectsCollectedByMajorGC` and
`includeObjectsCollectedByMinorGC`), taken over 300 ticks from the 50k checkpoint after a 100-tick
warm-up, records 9.4 MB allocated per tick at 962 settlers and 217 buildings: about 340 MB/s at x3.

By share of sampled bytes:

- About 16% is the combat index rebuild (`admit`, `candidatesInBand`), owned by
  [combat-index-rebuilt-every-tick.md](combat-index-rebuilt-every-tick.md), and 9% the building
  walk-block rebuild (`deriveBuildingBlockedCells`, `doorPassage`), owned by
  [building-blocked-cells-rebuilt-per-construction-advance.md](building-blocked-cells-rebuilt-per-construction-advance.md).
  `canonicalById` adds 3%, owned by
  [canonical-queries-resorted-per-call.md](canonical-queries-resorted-per-call.md).
- About 17% is stock-map iteration by destructuring: `for (const [goodType, amount] of amounts)`
  allocates an entry pair per stock line on every call, and these helpers run per candidate store for
  every seeker. `lowestStockedFood` (`systems/family/food-search.ts`) 5.6%; the pile scan's accept in
  `nearestCollectablePileFor` (`systems/settlers/targets/resources.ts`) 6.4%, whose only allocating
  step is the inlined `lowestStockedGood` (`systems/stores/capacity.ts`) walk (inferred from the
  inlined attribution); `lowestDemanded` (`systems/family/quality-search.ts`) 3.2%;
  `collectGrantedStock` (`systems/settlers/planner/assistant-grants.ts`) 1.2%.
- 6.3% is `NodeBuckets` (`systems/spatial/nodes.ts`) rebuilt from scratch each tick, a `Map` per
  column and an array per bucket, by production's `operatorIndex`, `PlannerSpacing.forTick`, the
  gossip candidates and `collectColliders` for posts.
- The rest is a tail under 3% each (the `near` sort in `systems/spatial/region.ts`, `fleeDrive`
  sets, `technologySystem`, the planner's `fieldZones`).

The candidate counts these helpers scan are cut by the planner, family and gatherer tickets; the
per-call garbage stays until the helpers stop allocating.

## Scope

- Walk stock maps in per-candidate helpers without per-entry pairs (`forEach` with a hoisted callback,
  or `keys()` plus `get`): `lowestStockedGood`, `lowestStockedFood`, `lowestDemanded`,
  `collectGrantedStock`, and any other helper a fresh heap profile shows above 1%. These are
  order-free min scans or sums, so no result changes.
- `NodeBuckets`: a flat node-keyed layout with ascending-id buckets, and owners that rebuild per tick
  clear and refill one instance instead of allocating a new one.
- Pure cost work: the state hash must stay identical.

## Verify

- Unit: the helpers return the same good for maps in several insertion orders; `NodeBuckets.nearest`
  and `at` answer as before after a clear and refill.
- Session and checkpoint recipe: the twelve-player run in `docs/DEVELOPMENT.md` (Measuring
  performance); a checkpoint family from this session's 60k run exists in the worktree's `bench-out/`.
  With the session env, `ON_BENCH_CHECKPOINT=<50k checkpoint> ON_BENCH_TICKS=5000
  ON_BENCH_WINDOWS=5 npm run bench:map` before and after, then `npm run bench:compare`: the per-window
  `gc ms` and `gc n` columns fall, the state hash unchanged. The same heap sampling over 300 ticks from
  the 50k checkpoint shows the listed helpers gone from the allocators above 1%.
- `npm test`, `npm run check`, `npm run build`.
