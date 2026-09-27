# Bound one AI seat's decision pass

**Area:** sim · **Focus:** ai-player · **Priority:** P2
**Needs user:** re-aiming a seat's flags over several decisions, or running its modules on different
ticks, changes when AI commands land

Seats decide on their own slots (`aiDecisionDue`, `ai-player/cadence.ts`) and re-aim their collector
flags on their own round (`flagRelocateDue`, `workforce/collectors/upkeep.ts`), so no two of seats 0-6
pay a pass on the same tick. With twelve seats, pairs (0,7), (1,8), (2,9), (3,10) and (4,11) decide on
neighbouring ticks. One seat still runs all five modules in one tick, and its relocation round is the
heaviest pass a healthy seat has.

Measured on `magiczny_las`, AI seats 0-5 plus the map's seat 6, 1500 ticks from a 60k checkpoint, quiet
box: `aiPlayer` mean 2.0 ms, p95 7.6 ms, max 62 ms. Every tick in the slowest list is one seat's
relocation round at 35-62 ms; ordinary passes stay under that. On `krwawa_rzeka`, 12 AI seats, 2000
ticks from t80k (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`): healthy seats' relocation rounds cost 18
to 31 ms mean and 40 to 68 ms max, ordinary passes 6 to 10 ms; `aiPlayer` is 12.9% of the sim at t100k.

Profile of the same ticks, share of the whole profile: `aiPlayer` 16.4%, `runWorkforce` 14.0%:

- `upkeepHolders` 4.4%. `patchWorked` 2.2%, most of it `RouteRegions.pocketed` flooding a flag centre
  after the building overlay changed. `replantSpot` 2.1%, the flag-spot walk floods: one full relocation
  cycle (every seat once) settles about 272k nodes, with 8 floods reaching their budget and no query for
  a blocked or unwalkable node, so the floods measure real distance rather than waste.
- `corridorGoals` -> `nearestLiveResource` 2.5%: the region index collects and sorts every resource of
  every good in the box, so a good that stands only far away, or not on the seat's ground, pays for the
  whole map once per decision. On `krwawa_rzeka` at t100k it is still 2.1%, most of it because
  `allocateScout` calls `nextSignpostTarget` on every decision only to decide whether to hire a scout
  (2.8% inclusive); `region.near` allocates 318 KB a tick, 259 KB of it through `bestLiveResourceInBox`.

## Scope

- The pass rate is [its own decided ticket](ai-decision-interval-48.md); this one cuts what a pass costs.
- Without changing answers: a per-good view of the resource region index for the nearest searches that
  folds over the region buckets by (distance, id) instead of collecting and sorting them, and the scout
  hire decided without a full `nextSignpostTarget` search. A walk-flood cache that outlives one decision
  keys on the dynamic block overlay, which moves with every resource or building change; measure its hit
  rate before building it.
- With the owner's ruling, one commit each, goldens moved and named: re-aim a seat's holders over
  several decisions instead of all on its round (each holder still once per round; an origin flood is
  then paid on more decisions unless cached), or run the seat's modules on separate ticks after showing
  they do not couple through the tick they share today.

## Verify

- On an idle box, from a late checkpoint of one run (`docs/DEVELOPMENT.md`, Measuring performance):
  `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5 ON_BENCH_CHECKPOINT=<checkpoint>
  ON_BENCH_TICKS=1500 npm run bench:map` before and after, then `npm run bench:compare`. The slowest
  relocation-round pass falls toward 10 ms, and the hash-identical step keeps the printed state hash.
- `npm test`, `npm run check`, `npm run build`.
