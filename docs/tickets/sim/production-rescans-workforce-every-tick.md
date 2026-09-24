# Make the production tick scale with running workshops

**Area:** sim · **Focus:** economy/production · **Priority:** P2

`production` is the fastest-growing system of the twelve-player late game: on
`magiczny_las_12_players` with 13 AI seats its window median rises from 0.006 ms (ticks 203-5202,
96 buildings, no workshop running yet) to 0.907 ms (ticks 55203-60202, 1011 settlers, 233 buildings),
143x, and holds 4-4.5% of the tick in every late profile (`productionSystem` 3,140 ms inclusive over
the 4,000 ticks profiled from the 40k checkpoint; profiled timings are inflated by the sampler).
Only 28-39 workplaces hold a running `Production` at any checkpoint, yet the tick pays for the whole
population and every building:

- `operatorIndex` in `productionSystem` (`systems/economy/production.ts`) builds a `NodeBuckets` over
  every `Person` with a `canonicalById` sort each tick (21% of the system at 40k; 659-780 persons), only
  so `presentOperators` (`systems/stores/operators.ts`) can probe one door node per workshop.
- `new WorkshopWorkforce(...)` (`systems/stores/workshop-workforce.ts`) runs whenever a multi-recipe
  workshop has a spare operator: a sorted scan of every `JobAssignment` settler (288-334) with
  `boundWorkplaceTarget`, `isWorkplaceOperator`, `bankedSlot` and supply-run checks per settler (31%).
- The start loop calls `anyCycleStartable` for every built building with recipes every tick, each
  re-reading tech enablement per recipe (`recipeOutputsEnabled` alone is 13%) even when neither its
  stock nor any unlock changed since the last tick (27.5%).

## Scope

- Find a workshop's operators from its own assigned workers (those whose `JobAssignment.workplace` is
  the workshop) standing on its door node, instead of a per-tick index of the whole population. The
  ascending-id order and the slot-headcount clamp of `presentOperators` stay as they are.
- Build `WorkshopWorkforce` data only for the workshops that start a cycle this tick, or keep it
  across ticks keyed on what it reads.
- Skip `anyCycleStartable` for a workshop whose stockpile, pending outputs and the owner's unlocks have
  not changed since it last answered false, with the key a pure function of world state.
- Same seed and input must give byte-identical state; this is a pure optimisation.

## Verify

- Headless: the existing production and workshop-workforce tests pass unchanged; a test with many
  idle persons and one running workshop shows the per-tick work no longer touches the idle ones.
- Session and checkpoint recipe: the twelve-player run in `docs/DEVELOPMENT.md` (Measuring
  performance); a checkpoint family from this session's 60k run exists in the worktree's `bench-out/`.
  `ON_BENCH_CHECKPOINT=<60k checkpoint> ON_BENCH_TICKS=2000 npm run bench:map`, then
  `npm run bench:compare`: `production` median well under its 0.88 ms profile median. The state
  hash must stay identical.
- `npm test`, `npm run check`, `npm run build`.
