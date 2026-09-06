# Execute the movement, area, and behaviour-flag opcodes

**Area:** sim · **Focus:** `systems/missions` · **Priority:** P2
**Blocked by:** [map-scripts-3-entities-and-ownership.md](map-scripts-3-entities-and-ownership.md)

Map-scripts epic, stage 4 of 10. Reference: [`docs/formats/MISSIONS.md`](../../formats/MISSIONS.md),
"Human behaviour flags" and the range-test goals.

Scripted units must walk somewhere and scripts must notice where the player is:
`FindPosByPlayersMapMoveable` (1,023 goals) and `FindPosByHumans` (626) gate most story beats,
`SendHuman` (705) and `MoveUnitsInArea` (346) move the actors. Behaviour flags make scripted units
passive, immortal, or uncontrollable, which every ambush and escort depends on.

## Scope

- A range metric: the original's hexagonal distance between map points, on the half-cell lattice.
  `systems/spatial/metric.ts` has `manhattan` and ring offsets; check whether they equal the
  original's hex distance and add a hex metric to `nav/halfcell.ts` if not. Every "within range"
  test in this epic uses it.
- Results `SendHuman` (walk order to the nearest unblocked node), `MoveHuman` and
  `MoveUnitsInArea` (teleport with a settle order and exploration around the destination),
  `StopHumanByPlayerId`, `RemoveHumansNearPos`, `HealHumansInArea`, `RemoveHPsOfHousesInArea`,
  `RemoveHPsOfHousesInAreaX`.
- Goals `FindPosByHumans`, `FindPosByPlayersMapMoveable`, `FindHumansByHumans`,
  `FindHumansByPlayersMM`, `FindHousesByHumans`, `NumberOfSoldiersNearPos`,
  `NumberOfCivilainsNearPos`, `NumberOfHousesInArea`, `NumberOfAnimalsInArea`, through the region
  index rather than full scans.
- Behaviour flags: `SetHumanBehaviourFlag`, `SetPlayerBehaviourFlag` (current humans only),
  `SetImportHumanFlag`; interpret the located bits where the sim has the capability (needs off,
  stay put, passive, invulnerable, not controllable, no job change, slow, fast) and keep the rest
  as opaque mask bits. `SetHouseBehaviourFlag` with bit 0 as indestructible.
- Non-goals: vehicles, goods, terrain.

## Where to look

`packages/sim/src/systems/movement`, `systems/orders` (walk orders), `systems/spatial/region.ts`
and `metric.ts`, `systems/settlers` (needs), `systems/defence` and `conflict` (retaliation, fleeing),
`systems/command` (player control gates).

## Verify

Headless scenarios: a unit entering a range fires the mission and leaving it clears the goal flag;
a passive scripted soldier does not retaliate; an invulnerable one keeps its hit points;
`MoveUnitsInArea` moves at most 20 humans; the hex metric matches hand-computed distances on both
row parities. Coverage delta. Normal gates.
