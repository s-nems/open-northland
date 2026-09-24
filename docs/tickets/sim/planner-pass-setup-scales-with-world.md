# Make the planner's per-settler sweep and spacing snapshot scale with the settlers that act

**Area:** sim · **Focus:** settlers/planner · **Priority:** P2

On `magiczny_las_12_players` with 13 AI seats (the session in `docs/DEVELOPMENT.md`, Measuring
performance), 1005 settlers stand in the planner's sweep at tick 60k: 182 hold an atomic, 483 are
travelling and 340 stand free, 160 of them unowned wildlife (exact counts). Two parts of the pass
still visit all of them every tick. In a busy-machine `npm run bench:profile` from the 40k checkpoint
(profiled timings are inflated by the sampler), they are:

- `releaseStaleIntent` (`settlers/planner/replan.ts`), 2.7% plus its copy inlined into
  `atomicPlanner`'s loop: every positioned settler pays the yard-route reconcile, both
  unreachable-memo prunes, the garrison check and `atomicHoldsSettler` before the busy early-out, and
  every travelling one the failed-route and feed-on-the-march checks before the travel early-out.
- `PlannerSpacing.forTick` (`settlers/planner/spacing.ts`), 1.5%: the `Settler + Position + Owner`
  join, an `isTravelling` filter over every owned settler and a `NodeBuckets` over the stationary ones.

## Scope

- Visit in the sweep only the settlers that can act this tick, in ascending id: those not held by an
  atomic or a live route, those holding a component a reconcile step reads (`YardDeliveryRoute`,
  `UnreachableGoals`, `UnreachableTargets`, `Garrison`, `IdleStand`, a failed `PathRequest`), and a
  combatant or shelter seeker whose route the release may stop. Whether an atomic holds depends on
  component values (a `produce` effect, a pastime chat), so a membership-only view is a superset
  filtered per visit. The ECS has no query that excludes a component; add one only if it keeps the
  visit order and stays checked under `verifyCaches()`.
- Keep the spacing occupancy the stationary owned settlers as of the pass start. A lazy build is not
  exact: the pass sets settlers walking, and `stepOut` moves a garrison's `Position` mid-pass. An
  incremental view needs settler `Position` writes, which every walker makes every tick, so measure
  the replay against the rebuild before choosing it.
- Pure cost work: state hashes must not move.

## Verify

- Counters over 200 ticks from the 60k checkpoint: sweep visits per tick fall from all 1005 settlers
  toward the ones that can act.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare`, on an idle box, trust clean: planner median falls with the state hash
  unchanged; `bench:profile` from the same mark shows `releaseStaleIntent` and `forTick` together
  under 2%.
- `verifyCaches` stays clean for any incremental index; `npm test`.
