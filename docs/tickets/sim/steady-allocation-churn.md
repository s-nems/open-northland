# Reduce the sim's steady per-tick allocation churn (snapshot clone floor)

**Area:** sim · **Priority:** P3

Two waves of cuts have landed. The first (on `perf/steady-alloc-churn`) reworked `World.query`,
the snapshot clone walk, and the spatial index builds. The second (on `perf/steady-alloc-churn-2`)
took the measured remaining sites: the ring searches no longer mint a visitor closure per ring
(`NodeBuckets.nearest`, `InteractionCellIndex.ringNearest`, `nearestFreeYardNode`), the hottest
per-tick loops use the scalar `nodeHxOfPosition`/`nodeHyOfPosition` pair instead of minting a
`{hx,hy}` per call, the AI store-scan predicates (`stockCapacity`, `canStoreGood`,
`lowestStockedGood`) run allocation-free per candidate, and `navigationLimitFor` is memoized per
settler on (node, owner, job, Signpost generation).

Second-wave proxy A/B (400 measured ticks, per-tick `step()` + `snapshot()` on the bench world,
GC-inclusive V8 sampling heap profiler with collected objects included): pure economy 3414 ->
2869 KiB/tick (-16%), economy with signpost confinement 3293 -> 2777 KiB/tick (-16%),
120 fighters/side 5148 -> 4224 KiB/tick (-18%). State hash unchanged; every site named by the old
"remaining sites" list dropped out of the top allocation table.

## Remaining work

- **Snapshot clone floor.** Now the dominant steady cost by far: in the pure-economy proxy the
  snapshot machinery (`forEachComponent`, `clonePlain`, `takeSnapshot` and their Map/iterator
  churn) accounts for roughly 2 of the remaining 2.9 MiB/tick. Every non-scenery entity still
  re-clones each frame. A wider clone cache needs every in-place mutation to go through
  `World.write`, so it is a deliberate, larger follow-up, not a quick cut.
- **Chrome A/B still owed.** The proxy is not the real map. The rate that motivated this ticket is
  a late-game `?map=magiczny_las&player=overseer&ai=0,1,2,3,4,5&fog=reveal` session at tick
  ~46 500 swinging `sampling.heapMb` between roughly 300 and 940 MB on a ~13 s cycle (measured
  post-first-wave, pre-second-wave). Re-measure that session on current main before scheduling the
  clone-cache work; the `pamięć` overlay sawtooth should already be visibly shallower.
