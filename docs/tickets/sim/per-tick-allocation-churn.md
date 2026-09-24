# Stop shared scan helpers from allocating per candidate

**Area:** sim · **Priority:** P3

Garbage collection grows with the settlement. On `magiczny_las_12_players` with 13 AI seats, the
trust-clean `npm run bench:profile` from the 40k checkpoint paused 1.15 s for GC over 4,200 ticks (997
collections, longest 16.9 ms), and `(garbage collector)` is 1.5-2.1% self in every profile. A
busy-machine 60k-tick `bench:map` run paused 0.4 s in its first 5,000-tick window (708 settlers) and
2.1 s in its last (1,011 settlers), 14 s in all (growth suspect). A sampling heap profile that keeps
collected objects (`node:inspector` `HeapProfiler.startSampling` with
`includeObjectsCollectedByMajorGC` and `includeObjectsCollectedByMinorGC`), taken over 300 ticks from
the 50k checkpoint after a 100-tick warm-up, records 9.4 MB allocated per tick at 962 settlers and 217
buildings: about 340 MB/s at x3.

By share of sampled bytes:

- About 16% is the combat index rebuild (`admit`, `candidatesInBand`), owned by
  [combat-index-rebuilt-every-tick.md](combat-index-rebuilt-every-tick.md). The 9% building
  walk-block rebuild (`deriveBuildingBlockedCells`, `doorPassage`) now runs only on a building
  placement, removal or tier swap; re-profile its share. `canonicalById` adds 3%, owned by
  [canonical-queries-resorted-per-call.md](canonical-queries-resorted-per-call.md).
- About 17% is stock-map iteration by destructuring: `for (const [goodType, amount] of amounts)`
  allocates an entry pair per stock line on every call, and these helpers run per candidate store for
  every seeker. `lowestStockedFood` (`systems/family/food-search.ts`) 5.6%; the pile scan's accept in
  `nearestCollectablePileFor` (`systems/settlers/targets/resources.ts`) 6.4%, whose only allocating
  step is the inlined `lowestStockedGood` (`systems/stores/capacity.ts`) walk (inferred from the
  inlined attribution); `lowestDemanded` (`systems/family/quality-search.ts`) 3.2%;
  `collectGrantedStock` (`systems/settlers/planner/assistant-grants.ts`) 1.2%.
- 6.3% is `NodeBuckets` (`systems/spatial/nodes.ts`) rebuilt from scratch each tick, a `Map` per
  column and an array per bucket. Production's `operatorIndex` goes with
  [production-rescans-workforce-every-tick.md](production-rescans-workforce-every-tick.md) and
  `PlannerSpacing.forTick` with
  [planner-pass-setup-scales-with-world.md](planner-pass-setup-scales-with-world.md); the gossip
  candidates and `collectColliders` for posts remain.
- The rest is a tail under 3% each (the `near` sort in `systems/spatial/region.ts`, `fleeDrive`
  sets, `technologySystem`, the planner's `fieldZones`).

The candidate counts these helpers scan are cut by the planner, family and gatherer tickets; the
per-call garbage stays until the helpers stop allocating.

## Scope

- Walk stock maps in per-candidate helpers without per-entry pairs (`forEach` with a hoisted callback,
  or `keys()` plus `get`): `lowestStockedGood`, `lowestStockedFood`, `lowestDemanded`,
  `collectGrantedStock`, and any other helper a fresh heap profile shows above 1%. These are
  order-free min scans or sums, so no result changes.
- `NodeBuckets` for the owners left after the production and planner-pass tickets land (gossip
  candidates, `collectColliders`): a flat node-keyed layout with ascending-id buckets, cleared and
  refilled in one instance instead of a new one per tick. Do this after those two tickets, so no owner
  they remove is reworked first.
- Pure cost work: the state hash must stay identical.

## Verify

- Unit: the helpers return the same good for maps in several insertion orders; `NodeBuckets.nearest`
  and `at` answer as before after a clear and refill.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: the per-window `gc ms` and `gc n` columns
  fall, the state hash unchanged. The same heap sampling over 300 ticks from the 50k checkpoint shows
  the listed helpers gone from the allocators above 1%.
- `npm test`, `npm run check`, `npm run build`.
