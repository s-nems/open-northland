# Implement wall gates and connect mission control

**Area:** pipeline, sim, app, render · **Priority:** P2

The mission result `1 Open/0 CloseWallGate` has no supported executor. It needs an authoritative
placed gate with open/closed state and navigation behavior, not only a wall sprite.

## Scope

- Verify gate identification, placement, ownership, footprint and opening rules against owned data
  and the original. Assess existing wall support before choosing the missing runtime seam.
- Load and render gates, expose the applicable player interaction and persist their state.
- Apply open/close changes to navigation and invalidate affected route caches deterministically.
  Establish behavior when a unit occupies or crosses a closing gate.
- Connect the script result to the player's gate at the map point, with explicit failure for invalid
  targets. Player commands and scripts must use the same state transition.
- Update opcode support and MISSIONS.md, naming unconfirmed collision or animation behavior.

## Verify

Cover passage through open gates, obstruction by closed gates, an existing route after a toggle,
wrong-owner and missing targets, occupancy and save/load. Register a visual interaction scene and
run normal gates plus pipeline/content checks if extraction changes.
