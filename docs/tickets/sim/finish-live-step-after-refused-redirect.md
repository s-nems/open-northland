# Finish the live step before retiring an unreachable move order

**Area:** sim · **Focus:** movement, player orders · **Priority:** P2

A failed move redirect can leave a settler stopped indefinitely between lattice nodes.
`drainPathRequests` (`systems/movement/routing.ts`) deliberately preserves the existing `PathFollow`
when a replacement route fails, so the walker can park at a node centre. On the next tick,
`playerOrderSystem` (`systems/orders/movement.ts`) calls `markLostWay` and `clearPlayerOrder`;
the latter clears navigation immediately, discarding the retained step before movement can finish it.

Verified through the full `Simulation` schedule with `testContent`, seed 1 and
`waterColumnMap(12,4,5)`: place an owned woodcutter at visual (0,0), disable needs, order it to
node (6,0), and step twice. Redirect to node (20,0) across the impassable water column. After one
step `PathRequest.failed` and the old `PathFollow` coexist; after the next, the route and order are
gone and the position is unchanged off-centre. It remains there for another 160 ticks with
`LostWay`. Source basis: current code and synthetic reproduction. The cross-river refusal is
legitimate; losing the safe stopping step is the defect.

## Scope

- Retire a failed player order only after the current step reaches a safe node centre, or preserve
  an explicit stopping route while dropping the rejected intent.
- Stop before continuing the obsolete route. Preserve the lost notification for a genuinely
  unreachable destination and allow a fresh order to replace the stopping action.
- Cover the same retirement path after a wall or gate invalidates an ordered route.

## Verify

- Add the full-schedule redirect regression to `packages/sim/test/conflict/orders/`: the rejected
  destination raises one lost event, the worker stops at a walkable node centre, and a subsequent
  reachable order succeeds. Include a diagonal leg and its midpoint.
- Keep the routing-level retained-path tests and the pathfinding budget tests passing.
- Run the standard gates in `docs/TESTING.md`.
