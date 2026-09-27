# Re-plan an idle settler every 24 ticks instead of 12

**Area:** sim · **Focus:** settlers/planner · **Priority:** P3

`IDLE_REPLAN_PERIOD_TICKS` (`settlers/planner/idle-replan.ts`) is `TICKS_PER_SECOND`, an approximation
chosen for cost: an idle adult re-runs its drive ladder once a second, staggered by entity id. On the
heavy-load reference (`docs/perf/heavy-load-magiczny-las-6ai.md`) the planner is a third of the tick
with several hundred idle settlers late in the run, and the idle tail's share of it scales with that
population divided by the period. On `krwawa_rzeka` with 12 AI seats
(`docs/perf/heavy-load-krwawa-rzeka-12ai.md`) on-beat idle ladder runs are only 19 to 25 a tick
(0.35 to 0.49 ms at t80k and t100k), so this period saves about 0.2 ms a tick there.

The owner has ruled a 2 s period acceptable: an idle settler takes up new work up to 2 s of game time
late instead of 1 s.

## Scope

- `IDLE_REPLAN_PERIOD_TICKS` becomes `2 * TICKS_PER_SECOND`. An alarm does not shorten it: between
  beats an idler its owner's shelters may draw runs only the shelter rung.
- Behaviour change: goldens and pinned hashes over idle settlers move in the same commit, which names
  this change. The planner already visits an idler only on its beat, so the saving is the ladder runs
  themselves; [the standing-wait cadence ticket](planner-standing-waits-replan-every-tick.md) would give
  seated crafters, garrisons and resting or sheltering settlers this period too.
- Count before and after through `Simulation.setInstrument`: idle ladder runs per tick.

## Verify

- `bench:map` for 4000 ticks from the reference's 80k checkpoint before and after
  (`docs/DEVELOPMENT.md`, Measuring performance; `ON_BENCH_MAP=magiczny_las ON_BENCH_SEATS=0,1,2,3,4,5`),
  then `npm run bench:compare`: planner mean falls, idle ladder runs per tick halve.
- The settler acceptance scenes still take up work; a test pins that an idler picks up a job within the
  period.
- `npm test`, `npm run check`, `npm run build`.
