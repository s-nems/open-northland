# Make the planner's per-tick setup scale with the settlers that plan

**Area:** sim · **Focus:** settlers/planner · **Priority:** P2

On `magiczny_las_12_players` with 13 AI seats (the session in `docs/DEVELOPMENT.md`, Measuring
performance), only 159 of 1008 settlers run the drive ladder per tick at tick 60k (exact call count
over 200 ticks from the 60k checkpoint), yet the planner's fixed work around the ladder visits the
whole world every tick. The trust-clean `npm run bench:profile` from the 40k checkpoint puts it at 9%
of the tick (922 settlers, 210 buildings; profiled timings are inflated by the sampler), and the
busy-machine profile from 60k at the same share. Stockpiles grow 345 -> 600 -> 1090 at ticks
10k/30k/60k (exact counts), so this cost grows with the settlement whatever the settlers do.

- `beginPlannerPass` (`settlers/planner/pass.ts`), 4.7% at 40k and at 60k: `collectTargets` re-sorts
  every stockpile, building, site, crop and ground drop by id (`canonicalById`) and walks every
  stockpile for yard occupancy; `ExternalQualityIndex` filters and buckets every stockpile;
  `PlannerSpacing.forTick` buckets every owned settler; `GossipCandidates`, `BattleFront`,
  `SeatDoors`, `ConstructionTaskClaims` and the claim tallies are built eagerly whether or not a
  settler asks. The pass's `ExternalFoodIndex` is owned by
  [family-food-index-rebuilt-every-tick.md](family-food-index-rebuilt-every-tick.md), which keeps one
  index across ticks for both callers.
- `releaseStaleIntent` (`settlers/planner/replan.ts`), 2.4% at 40k: runs the yard-route reconcile,
  both unreachable-memo prunes and the garrison check for every settler before the busy early-out,
  which 850 of the 1008 then take as busy or walking at 60k.
- `dispatchAssistantGrants` (`settlers/planner/assistant-grants.ts`), 1.9% at 40k: walks every
  settler to find the 1-in-24 due by `ASSISTANT_SCAN_PERIOD_TICKS`, and `collectGrantedStock` walks
  every stockpile times granting player times good on any tick with a due candidate (0.9% at 40k).
- `WorkSeatClaims.recipesFor` builds a `WorkshopWorkforce` over every employed settler whenever one
  producer plans (0.8% at 40k). `productionSystem` builds its own;
  [production-rescans-workforce-every-tick.md](production-rescans-workforce-every-tick.md) owns keeping
  one across ticks for both, and this ticket switches `recipesFor` to it.

Expected gain: about 1 ms of the 18.7 ms tick at 40k, of the 1.7 ms the first three items cost.

## Scope

- Build each pass member on first use, as `collectTargets` already does for its interaction-cell
  indexes, starting from the ascending-id lists of
  [canonical-queries-resorted-per-call.md](canonical-queries-resorted-per-call.md) instead of sorting.
  Load-bearing: a lazy build must read the state a tick-start build reads. `PlannerSpacing`'s occupancy
  is a tick-start snapshot of stationary settlers and the pass itself sets settlers walking, so it
  stays a snapshot or becomes an incrementally maintained index.
- Visit in `releaseStaleIntent` and the grant dispatch only the settlers that can act this tick: those
  not held by an atomic or a route, those whose held state can expire now, and the due stagger slice.
- Pure cost work: state hashes must not move.

## Verify

- Counters over 200 ticks from the 60k checkpoint: `releaseStaleIntent` visits per tick fall from all
  1008 settlers toward the ones that can act, and `dispatchAssistantGrants` visits to the due slice.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: planner median falls by about 1 ms with
  the state hash unchanged. `bench:profile` from the same mark shows `beginPlannerPass` under 2%
  (4.7% before), and it, `releaseStaleIntent` and `dispatchAssistantGrants` together under 4%.
- `verifyCaches` stays clean for any incremental index; `npm test`.
