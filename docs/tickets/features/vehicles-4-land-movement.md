# Move vehicles over land with clearance, continents and shoving

**Area:** sim · **Focus:** `packages/sim/src/nav`, `systems/vehicles` · **Priority:** P2

Vehicles path on the shared graph in the original: a node is passable when its blocked bit is
clear and its free-size class is `>= logicsize`; a goto requires the target on the vehicle's
continent; path budget 60; humans inside the footprint are shoved; speed
`max(3, (g*2 + 4) << catapult)` with ticks per node `(speed + 9999) / speed`
([VEHICLES.md](../../formats/VEHICLES.md#movement)). Open Northland has no per-mover clearance
and no vehicle mover; a vehicle stands where `createVehicle` put it (`systems/vehicles/create.ts`).

## Scope

- Compute a per-node free-size class on `TerrainGraph` as the largest hex-disc radius of passable
  same-continent nodes, capped at 7 (named approximation of the original's 3-bit class), updated
  with footprint changes. Ground speed class `g` from the existing terrain speed data.
- A vehicle mover: `moveVehicle {vehicle, x, y}` seat command (`e`), `stopVehicle` (`p`, task
  `interrupted`, returns to the current node), continent equality and no-commander refusals with
  the `vehicleNoPath` / `vehicleNoCommander` messages, the 60-node budget, and the snap of a target
  to the nearest unblocked node with the same continent key within radius 9 (shared with
  `SendVehicle`).
- Shove: settlers standing inside the footprint of an arriving vehicle receive a step-aside order.
- The footprint index moves with the vehicle; a parked vehicle blocks placement and other vehicles.
  The walk-block and placement caches (`footprint/vehicle-blocked-cache.ts`,
  `footprint/placement/blockers.ts`) key on the `Vehicle` store's membership and value generations,
  and the work-flag memo replays membership alone, so a move must write the component through
  `World.mut` and re-admit it to the journal, or refresh those caches explicitly.

Out of scope: water movement (ships ticket), the commander walking to the cart (crew ticket).

## Verify

Unit tests: clearance classes on a synthetic map, continent refusal, speed and tick counts for a
cart and a catapult, snap radius, shove, blocked footprint. Determinism golden for a cart moving
across the acceptance scene. `npm test`, `npm run check`.
