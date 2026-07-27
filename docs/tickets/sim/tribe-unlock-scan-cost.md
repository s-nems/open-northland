# Bound the tribeUnlockEnabled settler scan

**Area:** sim (progression) · **Priority:** P2

`tribeUnlockEnabled` (`packages/sim/src/systems/progression/unlocks.ts`) answers "is a settler of an
enabling job alive?" with a full `world.query(Settler)` scan per call, and rebuilds its `enablingJobs`
set from the tribe's `jobEnables` rows (265 for the viking) each time. Its callers probe per
candidate: `resolveOpenWorkerJob` calls `jobEnabled` per idle settler x workplace x job (fighter jobs
scan even with progression off), and production cycle starts call `goodEnabled` per cycle. Wildlife
pads every scan with never-matching `jobType: null` Settlers (433 on the bridge map), so a burst of
idle civilians on a populated progression-enabled map costs O(idle x buildings x jobs x settlers) in
one tick.

Measured with real `content/ir.json` and 600 settlers: 14 us per `startableCycleCount` call, so the
planner's per-operator seat gate (`workSeatCount`, one call per bound producer per tick) pays 53 us at
`work_joinery_01` and 82 us at `work_coin_mint` for a human seat, nearly all of it here.

Scope: make the gate O(1) per probe without changing its semantics (an empty edge set stays
"enabled"). Options: a per-tick memo keyed `(tribe, kind, targetId)`, or a maintained per-(tribe,
job) alive tally. A memo answers stale within the tick a gating settler dies; that window must be
deterministic and documented.

Verify: unit tests for the bounded gate (including the same-tick death window), and `npm run bench:map`
before/after, which is the run that has the wildlife the premise rests on.
