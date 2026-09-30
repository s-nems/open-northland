# Bound one AI seat's decision pass

**Area:** sim · **Focus:** ai-player · **Priority:** P2

Seats decide on their own slots (`aiDecisionDue`, `ai-player/cadence.ts`), and each collector flag is
re-aimed on its holder's own decision of the round (`flagRelocateDue`, `workforce/collectors/upkeep.ts`).
The nearest-resource search folds the wanted good's region buckets (`nearestResourceOfGood`,
`spatial/resources.ts`), and the scout hire asks for scout work only when the answer decides something.
One seat still runs all five modules in one tick.

On the [late-game reference](../../perf/magiczny-las-late-game.md), `magiczny_las`, seed 7,
AI seats 0-6, two 2000-tick repeats from tick 97200 after 200 warm-up ticks put `aiPlayer` at
3.071 and 3.077 ms mean per tick, p95 16.85 and 17.20 ms, and maximum 47.57 and 45.89 ms.
The plain repeats attribute about 19.2% of summed system time to AI. `WalkFlood.costTo` is
6.4% of sampled CPU time and `RouteRegions.regionOf` 7.5% inclusive across their callers; these
overlap their parent systems and cannot be added as separate savings.

## Scope

- Cut repeated collector reach and flag-spot traversal inside one seat's pass. The matching profile
  puts `allocateCollectors` and `upkeepHolders` at 9.5% inclusive each, and `replantSpot` at 6.7%.
- Count route-region epochs, flooded nodes, repeated origins and walk-flood cache opportunities.
  `RouteRegions.refresh` invalidates all region labels when building cells, resource-footprint
  generation or landscape topology changes. A cache that outlives a decision needs all relevant
  overlay inputs; measure its hit rate before building it.
- Origin-independent interaction stance pools have their own
  [ticket](interaction-stance-pool-recomputation.md); keep reachability and walking-cost work here.
- The pass rate is [its own ticket](ai-decision-interval-48.md).

## Verify

- On an idle box, from a late checkpoint of one run (`docs/DEVELOPMENT.md`, Measuring performance):
  `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5 ON_BENCH_CHECKPOINT=<checkpoint>
  ON_BENCH_WARMUP=200 ON_BENCH_TICKS=2000 npm run bench:map` before and after, then
  `npm run bench:compare`. Reduce AI mean, p95 and maximum against the reference without increasing
  another system's cost. Repeated before/after runs retain the same state hash; exercise cache
  invalidation after construction, resource changes and landscape edits in focused tests.
- `npm test`, `npm run check`, `npm run build`.
