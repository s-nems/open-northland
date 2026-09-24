# Make the planner's per-tick setup scale with the settlers that plan

**Area:** sim · **Focus:** settlers/planner · **Priority:** P2

On `magiczny_las_12_players` with 13 AI seats (the session in `docs/DEVELOPMENT.md` "Benchmarks"), only
159 of 1008 settlers run the drive ladder per tick at tick 60k (precise call count over 200 ticks from
the 60k checkpoint), yet the planner's fixed work around the ladder visits the whole world every tick:
about 10% of the tick at 40k (7.5 s of 77.5 s over 4,000 profiled ticks, 922 settlers, 210 buildings)
and at 60k (4.9 s of 49 s, 1055 settlers, 238 buildings), timings from `npm run bench:profile` and
inflated by the sampler. Stockpiles grow 345 -> 600 -> 1090 at ticks 10k/30k/60k, so this cost grows
with the settlement whatever the settlers do.

- `beginPlannerPass` (`settlers/planner/pass.ts`), 4.7% at both marks: `collectTargets` re-sorts every
  stockpile, building, site, crop and ground drop by id (`canonicalById`) and walks every stockpile for
  yard occupancy; `ExternalQualityIndex` filters and buckets every stockpile; `PlannerSpacing.forTick`
  buckets every owned settler; `ExternalFoodIndex`, `GossipCandidates`, `BattleFront`, `SeatDoors`,
  `ConstructionTaskClaims` and the claim tallies are built eagerly whether or not a settler asks.
- `releaseStaleIntent` (`settlers/planner/replan.ts`), 2.1-2.4%: runs the yard-route reconcile, both
  unreachable-memo prunes and the garrison check for every settler before the busy early-out, which 850
  of the 1008 then take as busy or walking.
- `dispatchAssistantGrants` (`settlers/planner/assistant-grants.ts`), 1.9-2.2%: walks every settler to
  find the 1-in-24 due by `ASSISTANT_SCAN_PERIOD_TICKS`, and `collectGrantedStock` walks every stockpile
  times granting player times good on any tick with a due candidate (0.45 s at 60k).
- `WorkSeatClaims.recipesFor` builds a `WorkshopWorkforce` over every employed settler whenever one
  producer plans (0.5 s, 1% at 60k). `productionSystem` builds its own; that half is not in scope.

## Scope

- Build each pass member on first use, as `collectTargets` already does for its interaction-cell
  indexes, and keep canonical lists incrementally rather than re-sorting them per tick. Load-bearing: a
  lazy build must read the state a tick-start build reads. `PlannerSpacing`'s occupancy is a tick-start
  snapshot of stationary settlers and the pass itself sets settlers walking, so it stays a snapshot or
  becomes an incrementally maintained index.
- Visit in `releaseStaleIntent` and the grant dispatch only the settlers that can act this tick: those
  not held by an atomic or a route, those whose held state can expire now, and the due stagger slice.
- Pure cost work: state hashes must not move.

## Verify

- With the session env,
  `ON_BENCH_CHECKPOINT=<tick-60k mark> ON_BENCH_TICKS=5000 ON_BENCH_WINDOWS=5 npm run bench:map` before
  and after, then `npm run bench:compare`: planner median falls with the state hash unchanged. The
  recipe in `docs/DEVELOPMENT.md` writes the checkpoint family; one exists in this session's worktree
  `bench-out/`. `bench:profile` from the same mark shows `beginPlannerPass`, `releaseStaleIntent` and
  `dispatchAssistantGrants` together well under 10%.
- `verifyCaches` stays clean for any incremental list; `npm test`.
