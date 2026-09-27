# Keep an alarmed seat's idlers off the full drive ladder between their beats

**Area:** sim · **Focus:** settlers/planner, defence · **Priority:** P2
**Needs user:** whether an idler of an alarmed seat may notice ordinary work on its idle beat instead of
every tick

`idleReplanPeriodTicks` (`settlers/planner/idle-replan.ts`) gives every idler of an owner with a shelter
on alarm a period of 1, whatever its job, so each of them runs `planAdult` every tick; the ladder tries
`planShelter` first and, when no shelter takes the settler, falls through every other rung. The sweep
finds such idlers through `SweepCandidates.firstTakingCover` (`settlers/planner/sweep.ts`), which scans
the travelling and idle lists of every owner, and `seeksShelterEnRoute` runs on every visit.

Measured on `krwawa_rzeka`, 12 AI seats (`docs/perf/heavy-load-krwawa-rzeka-12ai.md`): an alarm stood on
every tick of both 2200-tick windows (t80k: one seat; t100k: two on average), with one building held in
`DefenceMode` for the whole window and 10 to 20 civilians sheltering. At t100k the planner visits 1001
settlers and runs 341 ladders a tick; 103 of the runs are off-beat alarmed idlers, 1.1 ms of the
planner's 5.35 ms a tick; `seeksShelterEnRoute` runs on 993 visits (1.18% of the profile) and
`firstTakingCover` costs 0.72%. The same alarm drives the housewives' food searches (`planWomanHoard`
1.93% at t100k) and 213 missed builder-site queries a tick.

## Scope

- Investigate first why the alarm stands for whole windows at t80k and t100k (a raider loitering in the
  watch band, or a defence mode that never clears); a defect there is fixed here and the numbers
  re-measured before the rest.
- Hash-identical: split the sweep's travelling and idle lists by owner, so an alarm scans only its
  owner's settlers.
- Behaviour change, on the owner's ruling: an alarmed idler off its beat runs only the shelter rung and
  keeps the full ladder for its idle beat. An alarmed civilian still claims a free door within one tick.

## Verify

- Ladder runs per tick by class (temporary counter) and the planner mean from the reference's t100k
  checkpoint against the numbers above.
- The shelter and defence tests pass; goldens move only with the behaviour half, named in the commit.
- `npm test`, `npm run check`.
