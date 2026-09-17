# Extract the complete vehicle type, house and graphics data

**Area:** pipeline, data · **Focus:** `tools/asset-pipeline/src/decoders/ini`, `packages/data/src/schema` · **Priority:** P2

`VehicleType` (`packages/data/src/schema/actors/vehicles.ts`) keeps only `stockSlots`,
`passengerSlots`, `logicSize` and `cargoGoods`. The runtime rules in
[VEHICLES.md](../../formats/VEHICLES.md) also need `logicpassenger`, `vehicleslots`,
`passengervector`, `logicdragginganimaltribe` and `logictransformvehicleType`, and the two `oxcart`
rows (types 2 and 6) share one slug, so `id` is not unique. Vehicle houses 42..46 lose
`logicvehicletype` and `logicignorecontinentsflag` at extraction
(`decoders/ini/types/buildings.ts`), the vehicle `jobgraphics` records are used for atlas conversion
only, the ship jobs 52/53 have no `gfxAtomics` rows because their bob rows carry raw frame indices
without `gfxbobseqbody`, and the `[StaticObjects]` verbs `attachtovehicle` / `moveintovehicle`
(21 and 18 corpus rows) are not decoded, so the crews of three maps' ships are lost.

## Scope

- Extend `VehicleType` with `passengerJobs` (job ids and the vehicle job ids 50/51/54 as listed),
  `vehicleSlots`, `passengerVector`, `draggingAnimalTribe`, `transformVehicleType`, and the vehicle
  job id `typeId + 49`. Give type 6 the slug `cart_no_ox` from `logicdefines.inc`; keep `commanderJob`
  and `stockvector` out (no runtime reader).
- Extract `logicvehicletype` and `logicignorecontinentsflag` on `BUILDING_KIND.vehicle` houses and
  expose the good-to-house pairing (goods 59..63 to houses 42..46). Mark vehicle goods from
  `goodtypes.ini` `isProducedOnMapFlag` instead of the slug match `stripVehicleGoods` relies on.
- Emit vehicle graphics into the IR: bob sequences of `CR_Veh_Body_00` (wait, walk, empty wait,
  catapult attack and drive, handcart wait), the ship frame rows of `LS_vehicles`, per-tribe palettes,
  and the ship player-colour palette, in the shape the render binding of
  [vehicle rendering](vehicles-3-vehicle-rendering.md) will read. Name the raw-frame ship rows as
  the source basis for jobs 52/53.
- Decode `attachtovehicle <x> <y>` and `moveintovehicle` on the preceding human record of
  `MapStaticObjects` (`boardVehicleAt: {hx, hy, inside}`), and `setvehicle`'s inert eighth column
  is ignored explicitly.
- Bump the IR version; regenerate `content/`.

## Verify

Synthetic decoder tests for every new key, the duplicate-slug case, the vehicle house pairing and
the `attachtovehicle`/`moveintovehicle` pair; `ini-static-objects` corpus counts (592 `setvehicle`,
21 `attachtovehicle`, 18 `moveintovehicle`). Pipeline and content gates from `docs/TESTING.md`.
