# Keep one food-source index across ticks

**Area:** sim · **Focus:** family · **Priority:** P3

On `magiczny_las_12_players` with 13 AI seats, the trust-clean `npm run bench:profile` from the 40k
checkpoint puts `family` at a 0.39 ms median, 2.3% of the tick (profiled timings are inflated by the
sampler). Nearly all of it is the child-order food haul: `driveChildOrders` -> `driveOrder` ->
`haulFood` (`systems/family/children/`) asks `ExternalFoodIndex.nearest`
(`systems/family/food-search.ts`) for a store to fetch from whenever a wife's larder is short, and the
index is created per tick in `driveChildOrders`. Its first query filters every `Stockpile + Position`
entity through `isHome` and `lowestStockedFood`; the ring search that
follows is below 1% of the cost. Over those 4,000 ticks `nearest` costs 937 ms under `family`, of
which the candidate filter is 688 ms. The planner pass builds a second
`ExternalFoodIndex` per tick (`beginPlannerPass`) with the same first-query cost. A busy-machine 60k-tick
`bench:map` run suggests `family` grows about 36x over the game (growth suspect).

The candidate universe grows with the settlement, not with the women searching: 348 stockpiles at
tick 10000, 762 at 40000, 1,075 at 60000 (exact counts), while 39-78 wives hold a `ChildOrder` and
only the ones in the larder-short stage ask. A wife who finds no reachable food keeps her order and
asks again next tick, so a single stuck wife is enough to pay the full rebuild every tick.

Size: about 0.23 ms of the 18.7 ms tick at 40k in `family`, plus the planner's copy. P3 until the
tick's larger terms are gone.

## Scope

- One `ExternalFoodIndex` kept across ticks and shared by both callers, the family child-order haul
  and the planner pass (`beginPlannerPass`), instead of two per-tick copies.
- Refresh only stores whose stock or membership changed, through `JournaledCaptures`
  (`ecs/journaled-captures.ts`) as the quality index's candidate set does
  (`systems/family/quality-search.ts`), so a tick's cost follows the stores that changed and the wives
  that ask. Catch it up where each caller's pass begins, not at the first query: the planner pass
  writes stock (a breeder's herd rows, a carrier's drop onto a yard heap), so today's first-query
  snapshot is not always the tick-start one its comment claims.
- Register a cache verifier that re-derives the candidate set under `verifyCaches()`.
- The winner must stay the one the current linear scan picks (distance, then entity id), with the
  owner, signpost-gate and unreachable-goal filters applied per seeker as today.
- Decision: a wife whose food search found nothing waits before asking again, on ticks where
  `(tick + entity) % FOOD_SEARCH_RETRY_TICKS === 0`, with the period between 6 and 12 ticks (half a
  second to a second at 12 ticks/s). A child order then resumes up to that delay after food reaches a
  store. State hashes change: land it as its own commit after the shared index, regenerate the goldens
  in it and name the behaviour change.

## Verify

- Headless: the family child-order tests and the planner's food tests pass (unchanged by the shared
  index; the retry wait may need to step a stuck wife to her next due tick); a test with
  many food-free stores and one searching wife shows the per-tick index work no longer scales with the
  store count; `verifyCaches` stays clean.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: `family` median falls by about half. The
  shared index keeps the state hash identical; the retry wait moves it knowingly.
- Headless: a wife with no reachable food searches once per `FOOD_SEARCH_RETRY_TICKS`, and resumes her
  order within that period once food reaches a store.
- `npm test`, `npm run check`, `npm run build`.
