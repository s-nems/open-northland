# Attach, detach and board crews on vehicles

**Area:** sim · **Focus:** `packages/sim/src/systems/vehicles`, `core/commands` · **Priority:** P2
**Blocked by:** [land movement](vehicles-4-land-movement.md)

No component holds riders and no command attaches a settler to a vehicle. The rules
([VEHICLES.md](../../formats/VEHICLES.md#crew)): attach gate (same player, job in
`passengerJobs`, commander slot first, then a free ordinary slot, no distance check), eviction from
the work house, walk to the vehicle, commander promotion on detach, boarding only on the door
node with the human removed from the map, straggler rule by continent, pending needs block
boarding, and carried vehicles boarding a ship.

## Scope

- Seat commands `attachToVehicle {human, vehicle}`, `detachFromVehicle {human}`,
  `boardVehicle {human}`; the human-side drive that walks the attached settler to the door node and
  boards when the vehicle asks; `unloadPeople` (`f` on a vehicle) onto the door node when on land.
- The vehicle's boarding drive: task `waitsForHuman` while anyone is outside; a passenger on
  another continent is detached instead; a pending need blocks; the `cannotEnterVehicle` and
  `vehicleNoPassengerRoom` messages.
- Ordinary human commands that force a detach first (work assignment, move, attack, home) and
  the refusal to detach from a ship that is not moored (`cannotLeaveVehicle`).
- Carried vehicles: `loadIntoVehicle {vehicle, carrier}` (`q`), `leaveCarrier` (`r`), the `boardsShip`
  task, crew transfer into the carrier, and the `vehicleCannotNearShip` / `cannotAttachVehicle`
  messages.
- Aboard settlers keep needs frozen and are excluded from map queries but stay owned by their seat
  for goals and defeat.

## Verify

Unit tests for every gate and message, commander promotion, straggler detach, carried cart boarding
a small ship and the transferred crew, save round trip with humans aboard. Acceptance scene:
a trader attaches to a handcart and a hero party boards a ship. `npm test`, `npm run check`.
