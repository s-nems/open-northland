# Load and unload vehicle cargo through wanted amounts and carriers

**Area:** sim · **Focus:** `packages/sim/src/systems/vehicles`, `settlers/drives` · **Priority:** P2

A vehicle's request list in the original is its wanted amounts: carriers serve any vehicle with
`wanted > reserved`, searching loose goods within radius 40 of the door, then a house, then the
guide network, and carry one unit to the door; unload flushes one reserved unit at a time
([VEHICLES.md](../../formats/VEHICLES.md#cargo)). `VehicleStock` holds the per-good current, wanted
and reserved bytes and `modifyVehicleStock` (`systems/vehicles/stock.ts`) already applies the
`Stock_ModifyAmount` clamp, the below-zero refusal, the dish aliasing and wanted-follows-actual;
Open Northland has neither the cargo seat commands nor a carrier drive for vehicles. The crew seat
commands exist (`systems/vehicles/crew.ts`, `boarding.ts`): `unloadPeople` is the people half of
`f`; the goods half is this ticket's `unloadVehicle`.

## Scope

- Seat commands `setVehicleWanted {vehicle, good, amount}` (`m`, clamped to `[0, stockSlots]` over
  the total) and `clearVehicleWanted {vehicle}` (`n`); `unloadVehicle {vehicle}` (`f`).
- Carrier drive rung `planVehicleSupply`: pick the nearest vehicle of the owner with a shortfall
  reachable on the carrier's continent, reserve the unit, fetch with the existing carry atomics,
  deliver at the door node through a `vehicleLoad` effect; `vehicleUnload` takes a reserved unit out
  to the nearest store or the ground. `noVehicleForWork` / `vehicleNoCarrier` messages when a
  vehicle waits and no carrier exists.
- Mission result `AddGoodsToVehicle` (full amount per matching vehicle, wanted raised) and the
  `[StaticObjects]` `addgoods` path (reserved and current only) on top of the entity's stock.

## Verify

Unit tests: wanted clamping, carrier supply from a pile, a house and across the budget, unload to a
store, aliasing goods, the two script paths. Determinism golden. `npm test`, `npm run check`.
