# Stop filtering every stockpile per tick in the planner's store searches

**Area:** sim · **Focus:** settlers/targets · **Priority:** P2

`collectTargets` builds a fresh `TargetBands` every planner pass, and three store questions answer from
a filter over `targets.stockpiles`, every positioned stockpile on the map (heaps and boat hulls
included), rather than from the cross-tick ledgers that already exist:

- `TargetBands.inputSources(g)` (`targets/bands.ts`) is
  `this.indexOver(this.stockpiles.filter((e) => this.isInputSource(walls, e, goodType)))`, and
  `isInputSource` is `storeYieldsGood`, the same membership `holding(g)` reads from
  `FetchableStock.holders(g)` minus buried piles in O(holders).
- `TargetBands.sinksFor` runs `canStoreGood` over every stockpile per good and mode.
- `nearestGroundPile` (`drives/economy/haul-targets.ts`) calls `nearestByCell` over
  `targets.stockpiles` for every porter plan: O(porters x stockpiles) per tick.

`nearestMissingInputSource` (`drives/economy/workshop/supply.ts`) also runs the player-blind band with a
`sameSideAs` filter; when the seeker's side holds none of a missing input, which is why it is missing,
the search ends in `linearNearest` over the whole band, and the next short input repeats it.

Measured on `magiczny_las`, AI seats 0-6, profile from the 80k checkpoint (2000 ticks, busy box),
share of the whole profile: `inputSources` 3.0% (2.2% self in the filter), `sinksFor` 1.3%,
`nearestGroundPile` 1.25%, `linearNearest` under `nearestMissingInputSource` 1.0%. The planner median
grew 25.8x from the first to the last 5k-tick window of a 100k run while settlers grew 4.3x.

## Scope

- `inputSources(g)` answers from `holding(g)` and `isInputSource` goes, after a test shows the two
  member sets agree for upgrading stores, construction sites, a workshop's own reserved inputs and
  buried piles.
- `nearestMissingInputSource` skips the search for an input when
  `FetchableStock.exceeds(owner, good, 0)` is false: no unit on the seeker's side or unowned, so no
  candidate can pass `sameSideAs`. An unowned seeker keeps the search.
- Store sinks per good and mode come from a journaled ledger (`JournaledCaptures`), and porters read a
  shared band of stocked non-building piles instead of a per-porter scan.
- Candidate sets and the `(distance, cell, entity)` order stay the same, so winners and the state hash
  do not change. Owner-partitioned indexes for the food and material searches are out of scope.

## Verify

- A test compares `inputSources` and `holding` membership, and a cache verifier covers the sink ledger.
- On an idle box, `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5
  ON_BENCH_CHECKPOINT=bench-out/ml6.t80000.checkpoint npm run bench:profile` (checkpoint from one 100k
  `bench:map` run with `ON_BENCH_CHECKPOINTS=80000`, `docs/DEVELOPMENT.md`, Measuring performance)
  before and after: the four entries above fall, the state hash is unchanged; `bench:map` for 4000
  ticks from the checkpoint and `npm run bench:compare` show the planner median.
- `npm test`, `npm run check`, `npm run build`.
