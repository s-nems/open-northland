# Bound the vehicle engagement's synchronous route search

**Area:** sim · **Focus:** conflict, vehicles · **Priority:** P3

`engageVehicle` → `startVehicleDrive` → `vehicleRouteTo` (`vehicles/movement.ts`) runs a full route search
under vehicle clearance and other-vehicle blockers inside the combat pass, outside the routing budget of
`drainPathRequests`. On the seed-7 `magiczny_las` replay at tick 99394, two runs spent 45.37/45.56 ms in
combat within 52.99/53.11 ms total; a one-tick CPU profile put about 50 ms of inclusive samples under
`engageVehicle → startVehicleDrive → vehicleRouteTo → findPath`, mostly repeated passability checks. The
search already memoizes complete walk-block verdicts within one call, which cut that tick's combat
maximum from about 45 to 31 ms with the same route answers.

The other searches outside the budget do not reproduce: on the six-AI `magiczny_las` checkpoints
(seed 2547456892, t100000 and t120000, 2000-tick CPU profiles) `palisadeBarring` and
`sealedByStructures` never ran, and `vehicleRouteTo` totalled 24-30 ms over 2000 ticks.

## Scope

- Profile the remaining cost of the seed-7 tick before adding another cache; keep exported overlay
  behaviour and fresh answers after blocker changes. Cross-search reuse needs a proven invalidation
  boundary.
- Charging the search to the routing budget, or deferring a vehicle to a later tick, changes behaviour
  and needs the owner's ruling.

## Verify

- Same complete state and route answers on the seed-7 replay before and after.
- That tick's combat time before and after, and no repeatable regression in ordinary tick time.
- `npm test`, `npm run check`, `npm run build`.
