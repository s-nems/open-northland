# Keep vehicle bodies from overlapping

**Area:** sim · **Focus:** vehicles movement · **Priority:** P2

Vehicles drive through each other. `vehicleWalkBlocks` (`systems/vehicles/movement.ts`) keeps only a
mover's anchor node off the other vehicles' cells (`vehicleBlockedCells`), and it exempts the mover's
own disc from that layer so the vehicle does not block itself. Two gaps follow:

- Every next node of a catapult (`logicSize` 1) or ship (2) lies inside its own disc, so the step-time
  check in `vehicleMovementSystem` never sees another vehicle there. A vehicle that parks across the
  route after it was planned is driven through. Only a handcart (radius 0) is blocked, and re-routes.
- The planner tests the anchor alone, so two catapults may stand one node apart with their discs
  overlapping, even when neither moves.

Owner's choice: vehicles collide fully. This is a deviation, since the original sets no blocked bit
for vehicles at all (docs/formats/VEHICLES.md "Movement").

## Scope

- A vehicle never takes an anchor from which its disc (radius `logicSize`) would share a node with
  another standing or driving vehicle's disc, in route planning and at each step. Its own disc never
  blocks it.
- A step blocked by another vehicle takes the existing re-route; with no way left the drive ends
  with `vehicleNoPath` as it does now. Two vehicles meeting in a narrow gap must not stand deadlocked
  in silence.
- The goto snap, dock ring, firing-node search and script teleport already read `vehicleWalkBlocks`
  and follow the same rule.
- Settlers stay out of scope: they are shoved, not collided.
- The blocked layer stays a derived cache scaled by vehicles that moved, not a per-tick pass over
  every vehicle's disc.

## Verify

- Movement tests: a cart parked on a catapult's next node forces a re-route; two catapults ordered
  through each other's positions never overlap discs on any tick; a head-on pair in a one-lane gap
  ends with a re-route or the no-path note.
- `verifyCaches` stays clean through those scenarios; same-seed runs hash the same.
- The vehicle scenes (`?scene=vehicles`, `vehicle-attack-move`) still reach their goals; the owner
  checks the look of a group of catapults driving together.
