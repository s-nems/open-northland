# Keep one food-source index across ticks

**Area:** sim · **Focus:** family · **Priority:** P3

On `magiczny_las_12_players` with 13 AI seats, the trust-clean `npm run bench:profile` from the 40k
checkpoint puts `family` at a 0.39 ms median, 2.3% of the tick (profiled timings are inflated by the
sampler). Nearly all of it is the child-order food haul: `driveChildOrders` -> `driveOrder` ->
`haulFood` (`systems/family/children/`) asks `ExternalFoodIndex.nearest`
(`systems/family/food-search.ts`) for a store to fetch from whenever a wife's larder is short, and the
index is created per tick in `driveChildOrders`. Its first query filters every `Stockpile + Position`
entity through `isHome` and `lowestStockedFood` after a `canonicalById` sort; the ring search that
follows is below 1% of the cost. Over those 4,000 ticks `nearest` costs 937 ms under `family`, of
which the candidate filter is 688 ms and the sort 187 ms. The planner pass builds a second
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
  and the planner pass, instead of two per-tick copies. This ticket owns it;
  [planner-pass-setup-scales-with-world.md](planner-pass-setup-scales-with-world.md) switches its
  pass member to it. Build it on the ascending-id list of
  [canonical-queries-resorted-per-call.md](canonical-queries-resorted-per-call.md) when that exists.
- Refresh only stores whose stock or membership changed (the ECS already journals membership for
  incremental indexes; stock writes need an equivalent change feed or a per-store revision check), so
  a tick's cost follows the stores that changed and the wives that ask.
- Register a cache verifier that re-derives the candidate set under `verifyCaches()`.
- The winner must stay the one the current linear scan picks (distance, then entity id), with the
  owner, signpost-gate and unreachable-goal filters applied per seeker as today.

**Gameplay limit option (needs the user's decision):** a wife whose search found nothing could wait a
fixed number of ticks before asking again. That removes the every-tick rebuild for stuck wives, but a
child order would resume up to that delay after food reaches a store. It is not the default.

## Verify

- Headless: the family child-order tests and the planner's food tests pass unchanged; a test with
  many food-free stores and one searching wife shows the per-tick index work no longer scales with the
  store count; `verifyCaches` stays clean.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: `family` median falls by about half. The
  state hash must stay identical unless the retry option is chosen.
- `npm test`, `npm run check`, `npm run build`.
