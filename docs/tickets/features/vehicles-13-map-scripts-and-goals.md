# Run vehicle placements, results and goals from map scripts

**Area:** sim, app, pipeline · **Focus:** `packages/sim/src/systems/missions`, `packages/app/src/game/world` · **Priority:** P2

`AuthoredEntities` drops the decoded `setvehicle` placements, every vehicle goal and result is
unsupported, and `MoveUnitsInArea`, `ChangePlayerPlayerId` and `ChangePlayerIdInArea` silently skip
their vehicle half. Semantics in [VEHICLES.md](../../formats/VEHICLES.md#map-scripts) and
[MISSIONS.md](../../formats/MISSIONS.md).

## Scope

- World build: `setvehicle` rows for occupied seats only (no `player >= 20` bypass; a dropped row
  drops its modifiers), `addgoods` into reserved and current, the human's decoded `boardVehicleAt`
  through the attach gate with the first as commander (`attachToVehicle` in
  `systems/vehicles/crew.ts`), and `inside` boarding through `boardRider`, which takes the rider off
  the map (`Rider` without `Position`). Decide which `oxcart`
  record a `setvehicle "oxcart"` spawns: the name join takes type 6 (no ox, admits no crew), yet
  Blekiny Nurt attaches carriers to its ox carts, which only type 2 admits.
- Results (`SendVehicle` and `DockVehicle` are done): `SetVehicle` (with the captain flag: investigate
  first what it spawns), `RemoveVehicles`, `ChangeVehiclesPlayerId`, `AddGoodsToVehicle`,
  `AttachHumanToVehicle`, `DetachHumanFromVehicle` (the seat commands' handlers), `ChangeMissionIdOfVehicles`,
  `ChangeMissionIdOfVehiclesInRange`, `ChangeMissionIdOfPlayersVehiclesOnContinent`,
  `RemoveVehiclesWithMissionId` (50-vehicle cap, crews only with the flag, wreck effect), and the
  vehicle halves of `MoveUnitsInArea`, `ChangePlayerPlayerId`, `ChangePlayerIdInArea`.
- Goals (`BuildVehicles` and `VehiclesDied` are done): `GoodsInVehicles`, `FindVehicles`, `FindPosByVehicles`, `FindHumansByVehicles`,
  `FindVehiclesByVehicles`, `FindHousesByVehicles`, `IsHumanInVehicle`, `NumberOfVehiclesInArea`,
  `NumberOfGoodsInVehiclesInArea`; `FindPosByPlayersMapMoveable` admits vehicles.
- Crews, cargo, orders and mission ids survive save/load and sub-mission return.
- `supported.ts`, opcode-support test and MISSIONS.md rows updated for implemented behaviour only.

## Verify

Synthetic mission tests per opcode; the `WYBRZEZE_CZAROW_SUB2` staticobjects fixture boards five
heroes with the first as commander; `BLEKINY_NURT` carts carry their goods; coverage report.
`npm test`, `npm run check`, `npm run check:docs`.
