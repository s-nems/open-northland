# Serve ascending-id component lists without sorting per call

**Area:** sim · **Focus:** ecs, spatial · **Priority:** P2

`canonicalById` (`systems/spatial/nodes.ts`) spreads its input into a fresh array and sorts it on
every call. Almost sixty call sites use it as `canonicalById(world.query(...))`, most of them once or
more per tick, over the same large stores: `Settler + Position` (about 1,000 at 60k), `Person`
(about 785), `Stockpile + Position` (about 1,090), `JobAssignment + Settler`, `Residence`. Several
systems sort the same population in the same tick.

On `magiczny_las_12_players` with 13 AI seats (the session in `docs/DEVELOPMENT.md`, Measuring
performance), the trust-clean `npm run bench:profile` from the 40k checkpoint puts `canonicalById` at
3.0% self and 3.6% total (profiled timings are inflated by the sampler), and the busy-machine
profiles from 30k, 50k and 60k at the same 2.8-3.2% self. It is where 42% of `QueryIterator.next`'s
1.2-1.3% self time is spent, and 3% of the bytes a sampling heap profile records over 300 ticks from
the 50k checkpoint. By share of its time at 60k, the callers split as: the planner pass
(`collectTargets` 12%, `PlannerSpacing.forTick` 7%, `beginPlannerPass` 6%), the family indexes
(`ExternalFoodIndex` 12%, `ExternalQualityIndex` 5%, `residentsOf` 5%, `driveChildOrders` 3%),
`WorkshopWorkforce` 9%, `technologySystem` 8%, `combatSystem` 7%, the husbandry drive's
`takeFromNeighbour` 6%, gossip 5%, production's `operatorIndex` 4%, and a tail through herding,
animal wander and the AI threat scan.

The sorted result rarely changes. Over 300 ticks from the 60k checkpoint the membership generation of
`Settler` moved on 14 ticks, `Building` on 1 and `Stockpile` on 117 (exact counts).

Expected gain: about 0.6 ms of the 18.7 ms tick at 40k.

## Scope

- A world-level canonical list per component: ascending ids, memoized on the component's membership
  generation or maintained incrementally (ids never recycle, so a new member appends), shared and
  frozen like `World.canonicalEntities`. A multi-component canonical query walks the smallest required
  component's list and filters on the others, so no call sorts.
- Replace the `canonicalById(world.query(...))` sites with it. A caller that mutates its list copies
  it first; the frozen shared list turns a missed case into a throw at the mutation site.
- The lazy pass members of
  [planner-pass-setup-scales-with-world.md](planner-pass-setup-scales-with-world.md) and the cross-tick
  food index of [family-food-index-rebuilt-every-tick.md](family-food-index-rebuilt-every-tick.md)
  build on this list rather than each keeping a sorted copy.
- This list is the sim's own; the app-side entity indexes of
  [03 Mirror indexes](../runtime-architecture/03-mirror-indexes.md) are maintained on the mirror from
  the snapshot delta and do not replace it.
- Pure cost work: the order is the same ascending id, so the state hash must stay identical.

## Verify

- Unit: the list equals `canonicalById(world.query(...))` after adds, removes and destroys, for single
  and multi-component queries; a registered cache verifier re-derives it under `verifyCaches()`.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: planner, family, production and
  `technologyAfterWork` medians fall a little each, with the state hash unchanged.
  `npm run bench:profile` from the same mark no longer lists `canonicalById` in the top 40 by self
  time.
- `npm test`, `npm run check`, `npm run build`.
