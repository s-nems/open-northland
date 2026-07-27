# Reduce the sim's steady per-tick allocation churn (long tail)

**Area:** sim · **Priority:** P3

A first wave of cuts landed on `perf/steady-alloc-churn` and roughly halved the steady rate in a
headless proxy that mirrors the app frame loop (per-tick `step()` + `snapshot()` on the bench world,
profiled with the same GC-inclusive CDP allocation sampling the original ticket described):

- `World.query` is a reused-result iterator, not a `{value,done}`-per-step generator;
- `World.forEachComponent` replaces the throwaway `componentEntries` array in the snapshot clone;
- spatial index/presence builds go through a callback (`forEachIndexNode`) with one reused visitor
  instead of a fresh `[{x,y}]` per entity;
- `snapshot` `clonePlain` no longer re-sorts object keys every frame (Map-entry sort kept).

Proxy A/B (400 measured ticks, 4 settlements, snapshots each tick): pure-economy -57%, 30
fighters/side -53%, 120 fighters/side -51%. `bench:sim` whole-tick median 3.34 ms -> 1.70 ms, p95
30.7 ms -> 7.85 ms, state hash unchanged.

## Confirm (still owed)

The proxy is not the real map. Run the original in-Chrome A/B on a busy map before considering the
halving proven: 8 s of 100 ms `performance.memory.usedJSHeapSize` samples (summing positive
increments) on `?map=blekiny_nurt` with active AI combat, before vs after the branch. The `pamięć`
overlay sawtooth should visibly flatten.

## Remaining sites (measured, after the first wave)

Each is real but lower-leverage than the wave above; take them only if the Chrome A/B still shows an
unacceptable rate. Sim purity/determinism and the scaling budget apply.

- **Ring searches** - `NodeBuckets.nearest` (`systems/spatial/nodes.ts`) and `ringNearest`
  (`settlers/targets/cell-index.ts`) allocate a result object per call and a `forEachRingOffset` closure
  per ring, under combat and the AI planner.
- **`nodeOfPosition`** (`nav/halfcell.ts`) returns a fresh `{hx,hy}` per call and is called broadly;
  a non-allocating variant for the hottest loops would help.
- **AI store scan** - `stockCapacity` / `lowestStockedGood` (`systems/stores/capacity.ts`) and
  `canStoreGood` (`settlers/targets/stores/stock.ts`) churn while the planner scans stockpiles.
- **`singletonCarrier`** (`components/rules.ts`) runs a full query per settler per tick via
  `signpostNavigationEnabled` -> `navigationLimitFor`; memoize the carrier on the component generation.
- **Snapshot clone floor** - every non-scenery entity still re-clones each frame. A wider clone cache
  needs reliable `World.touch` coverage on in-place mutations (today only ~17 sites touch), so it is a
  deliberate, larger follow-up, not a quick cut.
