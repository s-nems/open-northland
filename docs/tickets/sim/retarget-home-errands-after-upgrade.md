# Retarget home errands when an upgrade moves the entrance

**Area:** sim · **Focus:** settlers, home errands · **Priority:** P2

A resident already walking home can report that it is lost when an upgrade moves the entrance.
`finishBuilding` changes the building type and calls `settleFootprint`, which interrupts routes
through the new body. The resident's `MoveGoal` still names the old door, so that interruption
requests another route to an obsolete cell. When the new body covers it, pathfinding fails and
`releaseStaleIntent` raises `settlerLost` before the resident finally seeks the new entrance.
The new door remains reachable throughout; extending the signpost network cannot help.

Verified with the generated Frank (tribe 2) home `home_level_00` → `home_level_01` footprints
and synthetic economy data: seed 1, `grassNodeMap(128,40)`, home at node (90,20), fatigued
resident at (10,20), and a one-wood upgrade bill. Start its homeward sleep errand, order the
upgrade, and place a builder on the old construction perimeter. Ordinary build atomics complete
the upgrade while the resident is still travelling. It retains the covered old door, raises one
lost event, and eventually sleeps at the new door within 1,000 ticks. A forced-completion case
also reproduces with Egyptian (tribe 7) footprints. Source basis: current simulation behavior
and generated footprint data; this is an obsolete errand destination, not a claim about the original.

## Scope

- When a tier change moves the home entrance, retarget an in-flight home errand or release its
  obsolete intent for normal planning. Keep route searches within the existing routing budget.
- Preserve safe stopping during a live step and keep genuinely unreachable errands on the
  existing failed-route path. Do not replace unrelated player orders or other active tasks.
- Cover homeward sleep first; check the same entrance change for home prayer and food errands.

## Verify

- Add the ordinary-completion reproduction to the home/upgrade integration tests using both
  relevant nation footprints: the resident reaches the current entrance without `Stranded`, a
  newly recorded unreachable old door, or `settlerLost`.
- Keep unchanged-door upgrades and a genuinely blocked new entrance covered, including a
  resident already at the old door and a resident mid-step when completion occurs.
- Run the standard gates in `docs/TESTING.md`.
