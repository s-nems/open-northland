# Execute the spawn, removal, ownership, and population opcodes

**Area:** sim · **Focus:** `systems/missions` · **Priority:** P2
**Blocked by:** [map-scripts-2-mission-system-core.md](map-scripts-2-mission-system-core.md)

Map-scripts epic, stage 3 of 10. Reference: [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md),
goal and result tables and "Player state the goals read".

Spawning and removing scripted units is the bulk of every campaign script: `SetHuman` and
`SetHumanX` alone are 4,465 of 28,100 result lines, `HumansDied` 378 goals. Without them no map
produces its enemy waves or its rescue targets.

## Scope

- Results `SetHuman`, `SetHumanX`, `SetAnimal`, `SetHouse` (nearest buildable spot within 12 nodes,
  finished or as a site, warning when none), `RemoveHumans`, `RemoveAnimals`, `RemoveHouses`
  (silent: no death statistics, no cadaver), `ChangeHumanPlayerId`, `ChangeHousesPlayerId`,
  `ChangePlayerPlayerId`, `ChangePlayerIdInArea`, `ChangeAnimalPlayerIdInArea`,
  `ChangeMissionIdOfPlayer`, `ChangeMissionIdOfHumanInRange`, `ChangeHumanObjectIdInArea`,
  `SetHouseExtensionLevel`. Spawns go through the existing spawn system, not a parallel path.
- Per-player statistics the goals read, as a hashed component incremented by the owning systems:
  humans died and soldiers died on any non-script death, humans killed (soldiers and civilians)
  credited to the attacker.
- Goals `HumansDied`, `HousesDied`, `AnimalsDied`, `NumberOfHumansDied`, `SoldiersDied`,
  `NumberOfHumansKilled`, `BuildHumans`, `BuildHouses` (both tag the matches with the id unless
  the id is 12345), `Population`, `NumberOfSoldiers`, `HumansWithHome`, `CheckHumanJob`,
  `HumanAttachedToWorkHouse`.
- The `behaviourFlags` mask is stored on spawned and placed humans as an opaque value in this stage;
  its bits are interpreted in stage 4.
- An unresolvable name (a job the content lacks) warns and skips the line at world build.
- Non-goals: movement, area queries, behaviour bits, vehicles.

## Where to look

`packages/sim/src/systems/spawn`, `systems/lifecycle` (deaths), `systems/conflict` (kills and the
attacker), `components/ownership.ts`, `systems/footprint` (house placement),
`packages/app/src/game/world/authored-placements.ts`.

## Verify

Synthetic headless scenarios for each opcode. A real-content scenario loads a campaign map whose
script opens with `TimeGone 30` and a `SetHuman` wave (for example the CnMod `cn_1`) and asserts the
spawned count, their object id, and that `HumansDied` holds once they are removed. Coverage report:
state the delta. Normal gates, `npm run test:content`.
