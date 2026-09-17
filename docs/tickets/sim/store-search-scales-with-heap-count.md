# Bound the planner's store search on goods-dense maps

**Area:** sim · **Focus:** settlers/targets · **Priority:** P2

A decoded map's placed goods now spawn as loose heaps (`spawnMapGroundGoods`), so the store bands over
`Stockpile + Position` hold hundreds more members on goods-dense maps: 875 on `gringo`, 681 on
`saracen_4_sub_4`, 601 on `boso_przez_swiat`, under 100 on most others. The planner's per-tick cost
follows them. Measured with `npm run bench:map` (6 AI seats, 6000 ticks, same machine, both runs
"SUSPECT" trust from calibration drift): `gringo` planner 7.4 -> 10.8 ms/tick (+47%), tick total
41.1 -> 45.5 ms (+11%); `magiczny_las` (91 heaps) within noise (-3%). A CPU profile over ticks
400..1600 attributes the growth to `nearestStoreHolding` (0.18 s -> 2.8 s per 1200 ticks), split
between `TargetBands.holding` rebuilds and `InteractionCellIndex.nearest` ring misses, reached from
`fetchNeededMaterial` (builders) and `dispatchAssistantGrants`.

Two scaling faults sit under it:

- `TargetBands.ensureFresh` drops every band whenever `componentValueGeneration(Stockpile)` moves, and a
  settlement of hundreds of settlers moves it nearly every tick, so `holding(good)` re-filters the whole
  stockpile universe (`storeYieldsGood` per member) once per asked good per tick.
- `InteractionCellIndex.nearest` sweeps up to `NEAREST_RING_MAX_RADIUS` rings when nothing lies near
  (about 4600 bucket probes) and then falls back to a linear scan, so a band that grew past
  `RING_MIN_BUCKETS` pays the full sweep on every miss; before the heaps, the wood/stone/shoes bands
  stayed under the bucket threshold and were scanned linearly. A heap's cell is seeker-independent
  (its own node while no resource blocks it, `positionedInteractionCell`), so it can be bucketed, but
  bucketing alone was tried and moved nothing measurable: the miss sweep is the cost, not the tail.

## Scope

- Keep `holding(good)` bands valid across stock writes that cannot change membership, or key them on a
  per-good change signal, so a tick with hundreds of unrelated deposits rebuilds nothing.
- Make a ring miss cheaper than a linear scan of the band, or choose per query by the band's size and
  the gate's reach; the winner must stay the `(distance, cell-id, entity-id)` one.
- Both are pure cost work: state hashes must not move.

## Verify

`npm run bench:compare` before/after on `ON_BENCH_MAP=gringo` at 6 seats and on the default map, with
the state hash unchanged; the profile split above should shrink to the noise band.
