# Bound the planner's store search on goods-dense maps

**Area:** sim · **Focus:** settlers/targets · **Priority:** P3

A decoded map's placed goods spawn as loose heaps (`spawnMapGroundGoods`), so the store bands over
`Stockpile + Position` hold hundreds more members on goods-dense maps: 875 on `gringo`, 681 on
`saracen_4_sub_4`, 601 on `boso_przez_swiat`, under 100 on most others. On `gringo` (6 AI seats, 6,000
ticks, `npm run bench:map`, both runs flagged SUSPECT) the heaps raised planner time 7.4 -> 10.8 ms per
tick (+47%), and a CPU profile put the growth in `nearestStoreHolding`, split between
`TargetBands.holding` rebuilds and `InteractionCellIndex.nearest` ring misses. That measurement predates
the change that made `fetchNeededMaterial` resolve one source per good per builder
(`drives/economy/site-supply.ts`), which cut repeat builder queries.

The faults are still in the code:

- `TargetBands` (`settlers/targets/bands.ts`) is built per planner pass, so `holding(good)` re-filters
  the whole stockpile universe with `storeYieldsGood` once per asked good per tick, and again after any
  mid-pass stock write, since `ensureFresh` drops every band when `componentValueGeneration(Stockpile)`
  moves.
- `InteractionCellIndex.nearest` (`settlers/targets/cell-index.ts`) sweeps up to
  `NEAREST_RING_MAX_RADIUS` rings on a miss and then scans linearly, so a band past `RING_MIN_BUCKETS`
  pays the full sweep on every miss.

On a map with few heaps they are small: on `magiczny_las_12_players` with 13 AI seats at tick 60k (1090
stockpiles), `holding` is 1.3% of the profiled tick and `nearestStoreHolding` 0.6%, and 61.5 of the 62
`nearest` calls per tick take the linear path because the bands stay under the bucket threshold.

## Scope

- Measure first: `bench:profile` on `ON_BENCH_MAP=gringo` at 6 seats, early and after tick 20k. If
  `holding` plus `nearestStoreHolding` stay under about 5% of the planner, delete this ticket.
- Otherwise keep `holding(good)` bands valid across ticks and stock writes that cannot change their
  membership, or key them on a per-good change signal, and make a ring miss no dearer than a linear scan
  of the band. The winner stays the `(distance, cell-id, entity-id)` one, so state hashes must not move.

## Verify

`npm run bench:compare` before and after on `ON_BENCH_MAP=gringo` at 6 seats and on the default map,
with the state hash unchanged; the profile split above shrinks to noise.
