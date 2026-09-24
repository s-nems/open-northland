# Make the production tick scale with running workshops

**Area:** sim · **Focus:** economy/production · **Priority:** P2

On `magiczny_las_12_players` with 13 AI seats, the trust-clean `npm run bench:profile` from the 40k
checkpoint puts `production` at a 0.77 ms median, 4.5% of the tick (`productionSystem` 3,140 ms
inclusive over 4,000 ticks; profiled timings are inflated by the sampler), and the busy-machine
profiles hold it at 4-4.5% at every late checkpoint. A busy-machine 60k-tick `bench:map` run suggests
it is the fastest-growing system of the late game, from next to nothing before the first workshop
runs (growth suspect). Only 28-39 workplaces hold a running `Production` at any checkpoint (exact
counts), yet the tick pays for the whole population and every building (shares of the system at 40k):

- `operatorIndex` in `productionSystem` (`systems/economy/production.ts`) builds a `NodeBuckets` over
  every `Person` each tick (21%; 659-780 persons), only so
  `presentOperators` (`systems/stores/operators.ts`) can probe one door node per workshop.
- `new WorkshopWorkforce(...)` (`systems/stores/workshop-workforce.ts`) runs whenever a multi-recipe
  workshop has a spare operator: a sorted scan of every `JobAssignment` settler (288-334) with
  `boundWorkplaceTarget`, `isWorkplaceOperator`, `bankedSlot` and supply-run checks per settler (31%).
  The planner's `WorkSeatClaims.recipesFor` builds a second one per tick; see
  [planner-pass-setup-scales-with-world.md](planner-pass-setup-scales-with-world.md).
- The start loop calls `anyCycleStartable` for every built building with recipes every tick, each
  re-reading tech enablement per recipe (`recipeOutputsEnabled` alone is 13%) even when neither its
  stock nor any unlock changed since the last tick (27.5%).

Expected gain: about 0.6 ms of the 18.7 ms tick at 40k.

## Scope

- Find a workshop's operators from its own assigned workers (those whose `JobAssignment.workplace` is
  the workshop) standing on its door node, instead of a per-tick index of the whole population. The
  ascending-id order and the slot-headcount clamp of `presentOperators` stay as they are.
- Keep one `WorkshopWorkforce` across ticks, keyed on what it reads and checked by a cache verifier
  under `verifyCaches()`, and serve both `productionSystem` and the planner's
  `WorkSeatClaims.recipesFor` from it. This ticket owns it.
- Skip `anyCycleStartable` for a workshop whose stockpile, pending outputs and the owner's unlocks have
  not changed since it last answered false, with the key a pure function of world state.
- Same seed and input must give byte-identical state; this is a pure optimisation.

## Verify

- Headless: the existing production and workshop-workforce tests pass unchanged; a test with many
  idle persons and one running workshop shows the per-tick work no longer touches the idle ones.
- The recipe in `docs/DEVELOPMENT.md` (Measuring performance) writes the checkpoints. With its session
  env, `ON_BENCH_CHECKPOINT=<40k checkpoint> ON_BENCH_TICKS=4000 npm run bench:map` before and after,
  then `npm run bench:compare` of the two runs, on an idle box, trust clean: `production` median
  falls by most of the before run's value. Compare against that before run, never against a profile
  median. The state hash must stay identical.
- `npm test`, `npm run check`, `npm run build`.
