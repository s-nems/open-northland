# Release a chase whose target can be seen but never reached

**Area:** sim · **Priority:** P2

An owned ATTACK-stance combatant that spots a hostile it cannot path to stays engaged on it forever.
Measured on a 14x5 map split by a full-height water column, an owned fighter at cell (2,2) and an enemy
at (9,2) (14 nodes apart, inside `SIGHT_RADIUS_NODES`): the fighter carries `Engagement` for all 200
ticks of the run and never moves. `Engagement` benches the unit in `plannerSystem`, so it is lost to the
economy for as long as the enemy stands there.

`chase` (`packages/sim/src/systems/conflict/chase.ts`) only gives a target up on a failed route when the
unit is under an explicit order or an attack-move march; every other stance re-aims at the same
unreachable approach cell instead. The retry is also unthrottled: the failed `PathRequest` is cleared in
the same tick it is seen, and the `REPATH_CADENCE` throttle is guarded on `travelling`, which
`clearNavState` has just made false - so the search re-runs every tick against the shared
`PATHFINDING_NODE_BUDGET_PER_TICK`. (The per-tick search was traced through the code, not sampled: the
request is created and destroyed inside one tick, so an end-of-tick probe reads zero.)

## Scope

- Give the stance chases the same unreachable-target release the ordered paths already have, so a
  chaser hands back to the economy instead of standing.
- Throttle the retry whether or not the unit is travelling, so a repeatedly unreachable target costs one
  search per `REPATH_CADENCE`, not one per tick.
- Keep the ordered and attack-move releases as they are; only the autonomous stances change.

## Verify

- Headless: an ATTACK-stance fighter with an unreachable enemy in sight drops `Engagement` and is
  re-tasked by the planner; the same setup with a reachable enemy still chases.
- A bench or counted probe showing the retry is capped per `REPATH_CADENCE`.
- `npm test`; combat goldens move only if the release changes a scenario that had one.
