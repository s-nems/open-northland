# Read `logiccommander` into the IR for the scripted captain

**Area:** pipeline, data, sim · **Focus:** `tools/asset-pipeline`, `packages/data/src/schema`,
`packages/sim/src/systems/missions/results/vehicles.ts` · **Priority:** P3

`SetVehicle` with the captain flag (87 corpus lines, 7 of them ships) spawns a human of the type's
`logiccommander` job (`vehicletypes.ini`: 25 trader for the carts, 24 carrier for the ships, 31 for
the catapult; byte-verified in `Wonders.x64` `l_ExecuteResult` case 2). The IR's `VehicleType` has no
such lane, so the result seats the type's first `logicpassenger` entry instead: right for the carts
and the catapult, a `woman` (5) at a small ship's helm. Named in
[VEHICLES.md](../../formats/VEHICLES.md#map-scripts).

## Scope

- Extract `logiccommander` as `VehicleType.commanderJob` and bump `IR_VERSION`.
- `spawnScriptedVehicle` seats that job; drop the first-passenger fallback and the approximation note.

## Verify

`npm run test:pipeline`, the `SetVehicle` cases in `packages/sim/test/missions/mission-vehicles.test.ts`
updated to the ship's carrier, `npm run test:content`.
