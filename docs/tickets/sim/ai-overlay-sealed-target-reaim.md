# Stop re-aiming settlers at overlay-sealed targets every AI decision

**Area:** sim · **Priority:** P2

Profiled repro: settler e155 (seat 4, jobType 27, married, `Residence` home 35459) re-issues the same
`(243,322)→(201,352)` path request every 24 ticks from ~tick 1853 to the run's end. The goal node is
statically walkable and same-component, but the dynamic walk-block overlay (resource footprints +
building bodies) seals it inside a 494-free-node pocket — every request fails, and the settler never
gets wherever it is trying to go.

## Scope

Two things remain (the search cost is already bounded — `find-path.ts`'s flood guard refutes a sealed
goal at pocket cost):

1. **The 24-tick cadence defeats the stranded pacing.** `replan.ts` parks a failed route for
   `STRANDED_RETRY_TICKS` (48), yet the request reappears every 24 — the seat's decision interval —
   so some strategic command (`setJob`/`assignWorker`/`setWorkFlag` churn on this settler, or a
   drive with its own protocol) clears the failed request early. Identify it (re-run the profiling
   recipe, log which system clears e155's nav state) and make it respect or share the pacing.
2. **The target itself is dead.** Whatever aims there (the home? a construction site? a job seat)
   keeps choosing an overlay-sealed node. The chooser should either skip a target whose request
   just failed (blacklist for the episode, like the stranded pacing) or the placement that sealed
   the pocket (fields/buildings enclosing a door) should be prevented up front.

## Verify

- The profiling recipe (`ai-map-scenario.test.ts` setup, 2400 ticks, `sim.setInstrument`) shows no
  settler re-issuing an identical failed request each decision; goldens only move as a named
  intentional behavior change; `npm test`, `npm run check`, `npm run build`.
