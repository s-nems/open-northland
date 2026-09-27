# Bound one AI seat's decision pass

**Area:** sim · **Focus:** ai-player · **Priority:** P2

Seats decide on their own slots (`aiDecisionDue`, `ai-player/cadence.ts`), and each collector flag is
re-aimed on its holder's own decision of the round (`flagRelocateDue`, `workforce/collectors/upkeep.ts`).
The nearest-resource search folds the wanted good's region buckets (`nearestResourceOfGood`,
`spatial/resources.ts`), and the scout hire asks for scout work only when the answer decides something.
One seat still runs all five modules in one tick.

On `magiczny_las`, AI seats 0-5 plus the map's seat 6, 1500 ticks from a 60k checkpoint, on a busy box
(load 2.5 and 4.5 per cpu, so the numbers only rank): before these changes the four slowest ticks were
single-seat passes at 60-70 ms; after them one pass still took 61 ms (tick 60292) and the rest stayed
under 32 ms, with ordinary passes at 17-21 ms.

## Scope

- Measure before and after on an idle box and name what the remaining 60 ms pass and the 17-21 ms
  ordinary passes spend their time on (`bench:profile` over the same ticks).
- Candidates left from the earlier profile: `patchWorked` flooding `RouteRegions.pocketed` from a flag
  centre after the building overlay changed, and the `replantSpot` flag-spot walk floods. A walk-flood
  cache that outlives one decision keys on the dynamic block overlay, which moves with every resource or
  building change; measure its hit rate before building it.
- The pass rate is [its own ticket](ai-decision-interval-48.md).

## Verify

- On an idle box, from a late checkpoint of one run (`docs/DEVELOPMENT.md`, Measuring performance):
  `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5 ON_BENCH_CHECKPOINT=<checkpoint>
  ON_BENCH_TICKS=1500 npm run bench:map` before and after, then `npm run bench:compare`. The slowest
  single-seat pass falls toward 10 ms; a hash-identical step keeps the printed state hash.
- `npm test`, `npm run check`, `npm run build`.
