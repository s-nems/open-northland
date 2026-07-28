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

The A/B is still owed, but the absolute rate that makes it worth running is now measured: a late-game
`?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal` session at tick ~46 500 swings
`sampling.heapMb` between roughly 300 and 940 MB on a ~13 s cycle. That is post-first-wave, so the
remaining sites below are the live ones.

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
- **`navigationLimitFor`** (`systems/signposts/network.ts`) allocates a `Set`, a `posts.filter()`
  array, the `nodeBoxOfCircles` spread and a returned closure on every call. It is called per settler
  per tick from both `planAdult`/`planChild` and `jobSystem`, and `runAuthoredSlice` enables signpost
  navigation for every map session, so the early `signpostNavigationEnabled` exit never fires there.
  Memoizing `singletonCarrier` (`components/rules.ts`) on the component generation removes the query;
  the per-settler allocations are the larger half and need the limit itself cached or made
  non-allocating.
- **Snapshot clone floor** - every non-scenery entity still re-clones each frame. A wider clone cache
  needs every in-place mutation to go through `World.write`, so it is a deliberate, larger follow-up, not
  a quick cut.
