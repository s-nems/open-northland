# Model vehicles as one movable entity kind in the simulation

**Area:** sim · **Focus:** `packages/sim/src/components`, `systems/vehicles` · **Priority:** P2
**Blocked by:** [content](vehicles-1-content-vehicle-types.md)

The only vehicle today is the `placeBoat` hull (`systems/command/placement.ts`): `Position` +
`Vehicle {vehicleType, tribe}` + an empty `Stockpile`, shaped like a building. It has no hit points,
crew, cargo budget, task state, mission id or footprint, and a hand-dropped good lands in its hold
because `dropOrStackGood` does not exclude a `Vehicle`. The trader carries an intrinsic 15-slot
cart in `TradeRoute.cargo`. Nothing else can create, index or remove a vehicle. Every later vehicle
ticket needs one entity model; rules in [VEHICLES.md](../../formats/VEHICLES.md).

## Scope

- Replace the hull with a `Vehicle` component carrying: type, owner, tribe, hit points (5000 /
  5000 / 3000 / 1000), task (`none | docks | attacks | waitsForHuman | waitsForAnimal |
  interrupted | boardsShip`), facing, mission id, moored flag and mooring point, harnessed flag,
  carrier id, and a `VehicleStock` with a byte per allowed good for current, wanted and reserved
  units, the shared `stockSlots` budget, and the good aliasing (18, 19, 22 to 16; 20 to 17).
  Passenger slots `passengerSlots + 1` with the last as the commander slot, carried-vehicle slots,
  each `{entity, inside}`.
- A `VehicleIndex` world singleton (by entity, by mission id, by owner) and one trusted
  `createVehicle {type, x, y, owner, tribe, missionId}` command replacing `placeBoat`; a ship spawns
  moored when land lies within `passengerVector[1]` steps, else without a mooring point.
- Footprint: a hex disc of radius `logicSize` registered with the footprint index so placement and
  the later movement ticket see parked vehicles; the door node from `passengerVector`.
- Removal: `removeVehicle` frees passengers onto the door node when it is on land, otherwise kills
  them, frees carried vehicles recursively, and for carts and catapults drops all cargo within
  radius 10 and scatters ruins on 51 % of footprint nodes through the seeded RNG. Ships leave
  nothing. A defeated seat's vehicles are removed.
- `dropOrStackGood` and `stackOntoTile` share one heap predicate that excludes vehicles.
- Read views (`vehicleView`, `vehiclesOf`), save format bump with the golden regenerated, and the
  `Vehicle` armour column 6 of the equipment table wired into `resolveCombatHit` for vehicle targets.

Out of scope: movement, crew commands, rendering; those tickets consume this model.

## Verify

Unit tests: stock aliasing and clamping, commander slot, removal at sea versus on land, cargo
spill radius, hand drop beside a hull stays a ground pile, save round trip, defeat removal.
`npm test`, `npm run check`, `npm run build`.
