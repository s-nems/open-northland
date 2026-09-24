# Stop rebuilding the family food-source index every tick

**Area:** sim · **Focus:** family · **Priority:** P3

On `magiczny_las_12_players` with 13 AI seats, `family` rises from a 0.020 ms window median (ticks
203-5202) to 0.714 ms (ticks 55203-60202), 36x, 3.3% of the late tick. Nearly all of it is the
child-order food haul: `driveChildOrders` -> `driveOrder` -> `haulFood`
(`systems/family/children/`) asks `ExternalFoodIndex.nearest` (`systems/family/food-search.ts`) for a
store to fetch from whenever a wife's larder is short, and the index is created per tick in
`driveChildOrders`. Its first query filters every `Stockpile + Position` entity through `isHome` and
`lowestStockedFood` after a `canonicalById` sort; the ring search that follows is below 1% of the
cost. In the profile from the 40k checkpoint (4,000 ticks; profiled timings are inflated by the
sampler) `nearest` costs 937 ms, of which the candidate filter is 688 ms and the sort 187 ms.

The candidate universe grows with the settlement, not with the women searching: 348 stockpiles at
tick 10000, 762 at 40000, 1,075 at 60000, while 39-78 wives hold a `ChildOrder` and only the ones in
the larder-short stage ask. A wife who finds no reachable food keeps her order and asks again next
tick, so a single stuck wife is enough to pay the full rebuild every tick.

## Scope

- Keep the food-source candidates across ticks and refresh only stores whose stock or membership
  changed (the ECS already journals membership for incremental indexes; stock writes need an
  equivalent change feed or a per-store revision check), so a tick's cost follows the stores that
  changed and the wives that ask.
- The winner must stay the one the current linear scan picks (distance, then entity id), with the
  owner, signpost-gate and unreachable-goal filters applied per seeker as today.
- The planner pass builds its own `ExternalFoodIndex` per tick; its setup cost is owned by
  [planner-pass-setup-scales-with-world.md](planner-pass-setup-scales-with-world.md). A cross-tick
  index built here should serve both callers instead of two per-tick copies.
- In the same pass, `storedFoodUnits` (`systems/family/households.ts`) sums a home's food through the
  allocating, sorting `stockpileEntries`; a sum cannot depend on order, so iterate the amounts
  directly (5.6% of `family` at 40k).

**Gameplay limit option (needs the user's decision):** a wife whose search found nothing could wait a
fixed number of ticks before asking again. That removes the every-tick rebuild for stuck wives, but a
child order would resume up to that delay after food reaches a store. It is not the default.

## Verify

- Headless: the family child-order tests pass unchanged; a test with many food-free stores and one
  searching wife shows the per-tick index work no longer scales with the store count.
- Session and checkpoint recipe: the twelve-player run in `docs/DEVELOPMENT.md` (Measuring
  performance); a checkpoint family from this session's 60k run exists in the worktree's `bench-out/`.
  `ON_BENCH_CHECKPOINT=<60k checkpoint> ON_BENCH_TICKS=2000 npm run bench:map`, then
  `npm run bench:compare`: `family` median falls well under 0.5 ms. The state hash must stay
  identical unless the retry option is chosen.
- `npm test`, `npm run check`, `npm run build`.
