# Bound the tribeUnlockEnabled settler scan

**Area:** sim (progression) · **Priority:** P2

`tribeUnlockEnabled` (`packages/sim/src/systems/progression/unlocks.ts`) answers "is a settler of an
enabling job alive?" with a full `world.query(Settler)` scan per call, and its callers probe per
candidate: `resolveOpenWorkerJob` calls `jobEnabled` per idle settler x workplace x job (fighter jobs
scan even with progression off), and production cycle starts call `goodEnabled` per cycle. Wildlife
pads every scan with never-matching `jobType: null` Settlers (433 on the bridge map), so a burst of
idle civilians on a populated progression-enabled map costs O(idle x buildings x jobs x settlers) in
one tick.

Scope: make the gate O(1) per probe without changing its semantics (an empty edge set stays
"enabled"). Options: a per-tick memo keyed `(tribe, kind, targetId)`, or a maintained per-(tribe,
job) alive tally. A memo answers stale within the tick a gating settler dies; that window must be
deterministic and documented.

Verify: unit tests for the bounded gate (including the same-tick death window), and
`npm run bench:sim` on a populated map with hundreds of animals before/after.
