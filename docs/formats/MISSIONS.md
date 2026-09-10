# Mission scripts (`mission.inc`)

Every map carries a trigger script: a list of `[MissionData]` sections, each pairing goal
conditions with result actions. The original engine evaluates the list every few seconds and fires
the results of every mission whose goals hold. Campaign intros, timed enemy waves, tributes, unlocks,
victory and defeat, weather, and sub-missions all run through this one mechanism.

This page records the format and the execution semantics needed to reimplement it. Evidence classes,
in the order of [`SOURCES.md`](../SOURCES.md):

- **corpus**: read from the owned installation with CnMod 1.3.1 (the readable `.inc` files of
  118 map folders and the 124 generated `content/maps/*.script.json` sidecars). Counts below come
  from that baseline.
- **docs**: the CulturesNation goal and result references shipped in the installation's `Tools/`
  folder (`goals list EN.pdf`, `result list EN.pdf`) and the editor manual.
- **reading**: a reading of the original engine's code (the symbolised the original). A reading is a
  hypothesis until the running original confirms it; it names the mechanism to test, not a fact.
- **observation**: confirmed on the running original.

Nothing here is copied from the engine. Constants and semantics are described, never its code.

## Files and sections

A map folder's `map.ini` includes `mission.inc`, `staticobjects.inc`, `ai.inc`, `player.inc`, and
`misc.inc` (corpus). Packed base-game maps carry the same sections inside `map.cif`. Texts live in
`text/<lang>/strings.ini` (`[text] stringn <id> "..."`) and briefing pages in
`text/<lang>/briefings/NNNN.hlt` with their prose in a sibling `briefings.txt`
(`[blockstart:N]` .. `[blockend:N]`).

One `[MissionData]` section is one mission. Its index is its position in the file, counted from
zero; every `ActivateMission`, `CheckMission`, and `SetVisible` argument is such an index (corpus,
reading). Keys (corpus; defaults from the loader, reading):

| Key | Meaning | Default |
| --- | --- | --- |
| `debuginfo "<text>"` | editor name, kept to 30 characters | empty |
| `description <stringId>` | goal text shown in the mission window; the corpus writes `-1` for none | 0 |
| `active 0\|1` | active at load; an active mission records the load tick as its activation tick | 0 |
| `visible 0\|1` | listed in the mission window | 0 |
| `successfullif 0..3` | how many goals must hold: 0 all, 1 at least one, 2 at least half (rounded up), 3 none; any other value means always | 0 |
| `goal "<Name>" args...` | one condition, repeated | none |
| `result "<Name>" args...` | one action, repeated, executed in file order | none |

Corpus size: 124 sidecars carrying 5,016 missions, 6,658 goal lines and 26,148 result lines. The
largest script (Walhalla) has 526 missions; a typical campaign map has 60 to 150. Every "Uses" count
below is over that same set.

## Tokens and parameter kinds

A goal or result line is an opcode name followed by positional tokens. The engine reads exactly as
many tokens as the opcode's signature declares; extra tokens are ignored and a missing token reads as
zero (reading; the corpus has `SetLandscape` lines with 5 to 8 tokens and the engine declares 5).
Opcode matching ignores case (reading; the corpus mixes `explorearea` and `ExploreArea`). An
unknown opcode maps to index 0: goal `True` or result `None` (reading). Corpus misspellings such as
`setlandspace` and `missionmissionfailed` therefore load silently as no-ops or always-true goals.

Every parameter has a kind. A quoted name is resolved to an id for the kinds marked *name*; an
integer token is accepted for any kind, including name kinds (corpus: `EnableHouse 0 "viking" 41`
beside `AllowHouse 0 "viking" "work druid 01"`). Kind ids are the engine's own table (reading), the
descriptions match the docs.

| Kind | Meaning | Kind | Meaning |
| --- | --- | --- | --- |
| 1 | player id (0..19; 20 is the wild "player") | 20 | construction-site flag |
| 2 | second player id | 21 | mission index |
| 3 | tribe *name* | 22 | map id |
| 4 | job *name* | 24 | external AI flag id |
| 5 | vehicle type *name* | 25 | diplomacy state *name* (`friend`, `neutral`, `enemy`) |
| 6 | good *name* | 26 | sound id (`ATOMIC_ANIMATION_EVENT_SOUND_FX_TYPE_*` in `logicdefines.inc`) |
| 7 | amount | 27 | string id in the map's `strings.ini` |
| 8 | level | 28 | tribute slot (0..43) |
| 9 | range in map points | 29 | human behaviour flags (bitmask, see below) |
| 10 | human mission object id | 30 | captain flag |
| 11 | second human object id | 31 | campaign id |
| 12 | vehicle mission object id | 32 | boolean flag |
| 13 | second vehicle object id | 33 | cutscene replay flag |
| 14 | house or animal mission object id | 34 | cutscene id (briefing page number) |
| 15 | house type *name* | 35 | seconds of game time |
| 16 | x (map point) | 36 | info line index or bit index |
| 17 | y (map point) | 37 | opcode-specific |
| 18 | landscape name, kept as text | | |
| 19 | house name, kept as text | | |

Coordinates are map points of the original's grid, the same unit as `staticobjects.inc`: the
half-cell nodes of the `2W x 2H` lattice that `TerrainEntities` already stores as `hx` and `hy`
(corpus, pipeline). Range tests use the original's hexagonal map-point distance: one step per row,
with a diagonal walk carrying one column per two rows for free, so the distance is
`rows + max(0, columns - floor(rows / 2))`. Over an odd row span one further column step is free, in
the direction the destination row's parity picks, which makes the selected region lean to one side
(reading, from the engine's own hexagon-direction distance, which every range test calls; the lean is
unconfirmed against the running game).

## Mission object ids

Placed objects carry an id that goals and results address. The columns below are the corpus layout
and match the format the engine itself writes when it exports a `[StaticObjects]` section (reading):

| Line | Columns |
| --- | --- |
| `sethouse` | `<player> "<house name>" <level> <built> <x> <y> <id>` |
| `sethuman` | `<player> "<tribe>" "<job>" <x> <y> <id> <behaviourFlags>` |
| `setvehicle` | `<player> "<tribe>" "<vehicle type>" <x> <y> <id>` |
| `setanimal` | `<player> "<tribe>" "<species>" <x> <y> <id> <behaviour>` |
| `setguide` | `<player> <x> <y>` |

A `setanimal`'s player is 20 for a wild herd, and its third column is the animal type, not an age. A
run of `addgoods "<good>" <count>` after a `sethouse` or a `setvehicle` stocks what it just placed;
197 corpus lines stock a vehicle.

Corpus: 122 of the 124 maps place something, together 4,018 houses of which 772 carry an id (73
distinct values, `69` and `1000` to `1002` the most common), 35,279 settlers and 28,699 animals. In
the readable `staticobjects.inc` files, 4,578 of 34,650 `sethuman` lines carry an id (135 distinct,
`200` alone on 1,385 of them) and 21,730 carry a nonzero behaviour mask, against 47 of 592
`setvehicle` and 43 of 26,451 `setanimal` lines with an id; the 2,027 `setguide` lines have no id
column at all. Ids are not unique: one id names a group, and every lookup walks the whole entity
array (reading), which is why a reimplementation wants an id-to-entities index. Ids are also assigned
at runtime by `SetHuman`, `SetHouse`, `SetAnimal`, `SetVehicle`, the `ChangeMissionId*` results, and,
as a side effect, by the `BuildHumans`, `BuildHouses`, and `BuildVehicles` goals.

## Execution model

All of this section is a reading unless marked otherwise.

- The manager runs on the per-tick callback and evaluates when the tick count is a multiple of 36.
  At the original's 12 logic ticks per second that is every 3 seconds. `TimeGone n` compares
  `activationTick + 12 * n` with the current tick. Both constants need an observation with a stopwatch
  on the original (`TimeGone 30` should fire 30 seconds after activation, quantised to 3 seconds).
- A pass clears the pending sub-mission flags, then visits missions in index order, skipping inactive
  ones. A result can raise a stop flag (`PlayCutscene` does); the pass ends after that mission. After
  the loop the pending `EndSubMission` returns to the parent map, else a pending `StartSubMission`
  loads the sub map.
- One mission check evaluates every goal in order and stores each goal's current truth in the goal's
  done flag. Flags are not latched: a goal that stops holding clears its flag on the next check.
  `TimeGone` and `RandomTimeGone` are evaluated against the activation tick; every other goal runs
  through the evaluator described in the goals table.
- The count of true goals is judged by `successfullif`. On success the mission's active flag is
  cleared first, then every result executes in order, then the mission's "evaluated true" flag is
  set. That last flag is rewritten at every check and is not what `IsMissionDone` reads.
- Activation records the current tick only on the inactive-to-active transition. Activating an
  already active mission does not restart its timer. A mission may re-activate itself from its own
  results to loop (corpus: waves every N seconds). A mission never activated carries activation tick
  0, so a `CheckMission` probe of one reads its `TimeGone` as long since elapsed.
- `RandomTimeGone n` draws from the game's random generator, uniformly in `[n/2, n)` under integer
  division, and caches the draw in the goal record. The cache is cleared the moment the span elapses,
  not when the mission fires, so a goal held back by a second goal redraws on every later check. A
  reimplementation must draw from the simulation's seeded generator.
- A mission with no goals holds at once under `successfullif` 0, 2, and 3, and never under 1.
- `CheckMission n` evaluates mission `n`'s goals immediately (updating its goal flags) and reports its
  `successfullif` verdict without executing results. `IsMissionDone n` reads mission `n`'s stored goal
  flags and applies `n`'s own `successfullif` without re-evaluating, so it stays true after `n` fired
  until `n` is re-activated and checked again, and it is true for a never-checked mission whose rule is
  3 (no goals hold). `IfMissionIsActive n` reads the active flag.
- `RemoveHumans` and `RemoveAnimals` raise a "silent removal" flag around the removal so the deaths do
  not count in the player statistics; `RemoveHumans` also skips the cadaver.
- Results that only affect presentation reach the display through callbacks: open briefing, play a
  sound at a position, notification (won, lost), camera, selection, marker, explored area, player
  died, load and leave sub map, map point changed. For the reimplementation these are simulation
  events consumed by the app; the simulation never touches the display.

## Goals

Index and name from the engine table (reading). The goal reference shipped in the installation's
`Tools/` folder names the same 63 goals and gives each an example with the same number of arguments,
so the names and arities below are corroborated (docs); the semantics stay readings. Parameters list
kinds in order.

| # | Goal | Parameters | Holds when | Uses |
| --- | --- | --- | --- | --- |
| 0 | `True` | | always | 265 |
| 1 | `BuildVehicles` | 1, 5, 7, 12 | the player owns at least `amount` vehicles of the type; every match gets object id `arg4` | 2 |
| 2 | `BuildHumans` | 1, 4, 7, 10 | the player has at least `amount` humans with the job; every match gets object id `arg4` unless `arg4` is 12345 | 21 |
| 3 | `BuildHouses` | 1, 15, 7, 14 | the player owns at least `amount` finished houses of the type; every match gets object id `arg4` | 165 |
| 4 | `GoodsInVehicles` | 12, 6, 7 | vehicles with the id hold at least `amount` of the good in total | 3 |
| 5 | `GoodsInHouses` | 14, 6, 7 | houses with the id hold at least `amount` of the good in total | 10 |
| 6 | `GoodsGlobal` | 1, 6, 7 | the player's houses hold at least `amount` of the good as their own stock: everything a storage or a home shelves, of a workplace only what it makes, never its inputs | 11 |
| 7 | `FindPos` | 1, 16, 17 | the map point has been explored by the player (player 16 or more: always) | 23 |
| 8 | `FindHumans` | 1, 10 | any human with the id stands on a point explored by the player | 0 |
| 9 | `FindVehicles` | 1, 12 | as above for vehicles | 6 |
| 10 | `FindHouses` | 1, 14 | as above for houses | 0 |
| 11 | `FindPosByHumans` | 10, 16, 17, 9 | any human with the id is within `range` of the point | 589 |
| 12 | `FindPosByVehicles` | 12, 16, 17, 9 | as above for vehicles | 46 |
| 13 | `FindHumansByHumans` | 10, 11, 9 | any human with id A is within `range` of any human with id B | 20 |
| 14 | `FindHumansByVehicles` | 12, 10, 9 | any vehicle with id A is within `range` of any human with id B | 0 |
| 15 | `FindVehiclesByVehicles` | 12, 13, 9 | vehicle-to-vehicle range test | 0 |
| 16 | `FindHousesByHumans` | 10, 14, 9 | any human with id A is within `range` of any house with id B | 0 |
| 17 | `FindHousesByVehicles` | 12, 14, 9 | vehicle-to-house range test | 0 |
| 18 | `HumansDied` | 10 | no living human carries the id | 326 |
| 19 | `VehiclesDied` | 12 | no vehicle carries the id | 1 |
| 20 | `HousesDied` | 14 | no house carries the id | 41 |
| 21 | `PlayerDied` | 1 | the player's dead flag is set (see statistics) | 223 |
| 22 | `FindPosByPlayersMapMoveable` | 1, 16, 17, 9 | any human or vehicle of the player is within `range` of the point | 1135 |
| 23 | `BuildHouseOnContinent` | 1, 16, 17, 15 | the player has a finished house of the type on the continent of the point | 0 |
| 24 | `DiplomacyState` | 1, 2, 25 | the first player's stance toward the second equals the state | 83 |
| 25 | `HumansWithHome` | 1, 7 | at least `amount` adult humans of the player live in a finished home | 5 |
| 26 | `NumberOfSoldiers` | 1, 7 | the player has at least `amount` soldiers | 17 |
| 27 | `DetectGuide` | 1, 16, 17, 9 | the player has a guide (signpost) within `range` of the point | 3 |
| 28 | `TimeGone` | 35 | `seconds` of game time have passed since activation | 1529 |
| 29 | `CheckMission` | 21 | mission `n`'s goals hold now (evaluated without firing) | 20 |
| 30 | `PayTribute` | 28 | the tribute slot is open and paid: fresh from `CreateTribute` with nothing demanded, or paid by its owner (reading) | 702 |
| 31 | `Population` | 1, 7 | the player has at least `amount` humans of any age | 71 |
| 32 | `PlayerSeen` | 1, 2 | the first player has seen the second | 140 |
| 33 | `IsHumanInVehicle` | 10, 12 | every human with the id sits in a vehicle with the vehicle id | 0 |
| 34 | `FindHumansByPlayersMM` | 10, 1, 9 | any human with the id has a human or vehicle of the player within `range` | 14 |
| 35 | `SoldiersDied` | 1, 7 | at least `amount` soldiers of the player have died | 15 |
| 36 | `AnimalsDied` | 14 | no animal carries the id | 10 |
| 37 | `PlayerAttackedByPlayer` | 2, 1 | the first player has had a human damaged by the second (the victim's row, one direction) | 5 |
| 38 | `JobEnabled` | 1, 3, 4 | the job is enabled for the player's tribe | 34 |
| 39 | `GoodProduceable` | 1, 3, 6 | the good is produceable for the player's tribe | 150 |
| 40 | `NumberOfHumansDied` | 1, 7 | at least `amount` humans of the player have died | 118 |
| 41 | `FindAnimals` | 1, 14 | any animal with the id stands on a point explored by the player | 8 |
| 42 | `NumberOfGoodsTraded` | 1, 2, 7 | the first player traded at least `amount` goods with the second | 3 |
| 43 | `HumanAttachedToWorkHouse` | 1, 4, 7 | at least `amount` humans of the player with the job are attached to a workplace | 17 |
| 44 | `CheckNumberOfWildAnimals` | 3, 7 | at least `amount` wild animals of the species | 0 |
| 45 | `RandomTimeGone` | 35 | a random `[n/2, n)` seconds have passed since activation | 28 |
| 46 | `IfMissionIsActive` | 21 | mission `n` is active | 210 |
| 47 | `NumberOfAnimals` | 1, 3, 7 | the player owns at least `amount` animals of the species | 8 |
| 48 | `NumberOfHumansKilled` | 1, 7 | the player has killed at least `amount` humans (soldiers plus civilians) | 20 |
| 49 | `HumanIsOnContinent` | 10, 16, 17 | any human with the id stands on the continent of the point | 0 |
| 50 | `IsMissionDone` | 21 | mission `n`'s stored goal flags satisfy its rule | 325 |
| 51 | `NumberOfSoldiersNearPos` | 1, 16, 17, 9, 7 | at least `amount` non-hero soldiers of the player within `range`, vehicle crews included | 24 |
| 52 | `NumberOfCivilainsNearPos` | 1, 16, 17, 9, 7 | as above for civilians; a hero counts in neither | 14 |
| 53 | `ChestNearPos` | 16, 17, 9 | a chest landscape lies within `range` of the point | 6 |
| 54 | `NumberOfGoodsInArea` | 1, 6, 7, 16, 17, 9 | goods on the ground plus the own stock (as `GoodsGlobal`) of the player's finished houses within `range` reach `amount` | 113 |
| 55 | `NumberOfHousesInArea` | 1, 15, 7, 16, 17, 9 | the player has at least `amount` finished houses of the type within `range` | 33 |
| 56 | `NumberOfGoodsInHousesInArea` | 1, 6, 7, 16, 17, 9 | the own stock of the player's finished houses within `range` reaches `amount` | 8 |
| 57 | `NumberOfVehiclesInArea` | 1, 5, 7, 16, 17, 9 | the player has at least `amount` vehicles of the type within `range` | 4 |
| 58 | `NumberOfAnimalsInArea` | 1, 3, 7, 16, 17, 9 | the player has at least `amount` animals of the species within `range` | 11 |
| 59 | `CheckHumanJob` | 10, 4 | any human with the id has the job | 10 |
| 60 | `NumberOfGoodsInVehiclesInArea` | 1, 5, 6, 7, 16, 17, 9 | goods in the player's vehicles of the type within `range` reach `amount` | 0 |
| 61 | `IsAnyLandscapeOnPoint` | 16, 17 | the point carries a landscape object | 0 |
| 62 | `IsLandscapePlayer10ConstructionSignOnPoint` | 16, 17 | the point carries the `player10 construction sign` landscape | 0 |

Range tests use the original's hexagonal map-point distance. "Explored" is the per-player seen bit
of a map point, set once and never cleared (reading), which matches a reveal-style fog.

## Results

Same conventions. The result reference corroborates 102 of the 103 names and every arity;
`SetMapAreaMarker` (101) is absent there and unused by the corpus. "Sim" marks results that change
simulation state; "app" marks results that only drive presentation and become events; "both" do some
of each.

| # | Result | Parameters | Effect | Layer | Uses |
| --- | --- | --- | --- | --- | --- |
| 0 | `None` | | nothing | | 306 |
| 1 | `SetHuman` | 1, 3, 4, 16, 17, 10, 29 | spawn one human at the point with the id and behaviour flags | sim | 2067 |
| 2 | `SetVehicle` | 1, 3, 5, 16, 17, 12, 30 | spawn a vehicle; with the captain flag also spawn its commander at the door and board it | sim | 154 |
| 3 | `SetHouse` | 1, 19, 8, 20, 16, 17, 14 | place a house of the named type at the nearest buildable spot within 12 points, finished or as a construction site, with the id; warns when no spot exists | sim | 30 |
| 4 | `SetLandscape` | 16, 17, 18, 8, 32 | place the named landscape object at the point | sim | 760 |
| 5 | `RemoveHumans` | 10 | remove every human with the id, silently (no death statistics, no cadaver) | sim | 96 |
| 6 | `RemoveVehicles` | 12 | remove every vehicle with the id | sim | 16 |
| 7 | `RemoveHouses` | 14 | remove every house with the id | sim | 3 |
| 8 | `RemoveLandscape` | 16, 17 | clear the landscape object on the point | sim | 446 |
| 9 | `PlayCutscene` | 34, 33 | open briefing page `NNNN.hlt`; with the replay flag it becomes the page the mission window replays; stops the current pass; plays the briefing pop-up sound | app | 1450 |
| 10 | `ActivateMission` | 21 | set the active flag (records the activation tick on the transition) | sim | 4665 |
| 11 | `DeactivateMission` | 21 | clear the active flag | sim | 1905 |
| 12 | `MissionWon` | 1 | set the mission manager's won flag, send the "won" message and the notification with the player; in multiplayer also trigger the multiplayer goal manager. Here: the player's script verdict, announced like the skirmish rule's | both | 120 |
| 13 | `MissionFailed` | 1 | as above for "lost"; the player's dead flag stays clear and, here, its commands stay accepted (approximation) | both | 110 |
| 14 | `AllowMap` | 31, 22 | unlock a campaign map | sim | 0 |
| 15 | `CloseMap` | 31, 22 | lock a campaign map | sim | 0 |
| 16 | `ExploreArea` | 1, 16, 17, 9 | reveal the hexagon of `range` map points around the point for the player, ring by ring, and the area of any house or landscape on a revealed point; `0 0 0 0` (any zero x, y, or range) reveals the whole map; a player at or above 16 explores nothing. Here: the fog mask's cells, nothing with fog off, and a house or landscape reveals only what its own eye sees (approximation) | sim | 1412 |
| 17 | `Exit` | | leave the map (restart callback) | app | 70 |
| 18 | `SetExternalFlag` | 1, 24, 32 | set or clear condition slot `n` (below 100) of the player's AI handler, accepted only when that slot is an external-activate condition of its `ai.inc`; a seat without a handler drops it. Here: kept per player with no reader (see below) | sim | 67 |
| 19 | `SetDiplomacy` | 1, 2, 25 | set the first player's stance toward the second (one direction only, both slots in use), through any lock on the pair; the original sends a message unless the pair is marked not changeable | sim | 632 |
| 20 | `SetVisible` | 21, 32 | show or hide mission `n` in the mission window | app | 506 |
| 21 | `ChangeHumanPlayerId` | 10, 1 | hand every human with the id to the player (detached from houses) | sim | 266 |
| 22 | `ChangePlayerPlayerId` | 1, 2 | hand every vehicle, house, human, animal, and guide of the first player to the second | sim | 68 |
| 23 | `SendHuman` | 10, 16, 17 | order every human with the id to walk to the nearest unblocked point | sim | 521 |
| 24 | `SendVehicle` | 12, 16, 17 | order vehicles with the id to move there | sim | 49 |
| 25 | `DockVehicle` | 12, 16, 17 | order vehicles with the id to dock there | sim | 30 |
| 26 | `PlaySound` | 26, 16, 17 | play the sound effect at the point | app | 498 |
| 27 | `CreateTribute` | 28, 1, 2, 27 | open tribute slot `n` from the first player to the second with the description string, over whatever the slot held; starts paid and empty (reading) | sim | 995 |
| 28 | `AddTributeGoods` | 28, 6, 7 | add to the slot's demand for the good or append a new one, up to 5 kinds, and mark the slot unpaid; skipped on a closed slot (reading) | sim | 1135 |
| 29 | `AllowJob` | 1, 3, 4 | allow the job for the player's tribe and refresh its humans | sim | 5 |
| 30 | `AllowHouse` | 1, 3, 15 | allow the house type for the player's tribe | sim | 11 |
| 31 | `AddGoodsToHouses` | 14, 6, 7 | add the amount to every house with the id that has a slot for the good; the write is not capped at the slot | sim | 459 |
| 32 | `StartSubMission` | 31, 22 | after the pass: save the game, load the campaign sub map, embed the save | sim | 46 |
| 33 | `EndSubMission` | | after the pass: restore the embedded parent game | sim | 42 |
| 34 | `ChangeVehiclesPlayerId` | 12, 1 | hand vehicles with the id to the player | sim | 28 |
| 35 | `ChangeHousesPlayerId` | 14, 1 | hand houses with the id to the player | sim | 28 |
| 36 | `SetImportHumanFlag` | 10, 32 | set or clear behaviour bit 7 on humans with the id | sim | 8 |
| 37 | `EnableJob` | 1, 3, 4 | enable the job for the player's tribe | sim | 21 |
| 38 | `EnableHouse` | 1, 3, 15 | enable the house type; the original also flips a few good flags for three specific house types (id-specific, approximate) | sim | 75 |
| 39 | `DisableAll` | | deactivate every mission | sim | 83 |
| 40 | `AddGoodsToVehicle` | 12, 6, 7 | add goods to vehicles with the id that can carry the good | sim | 14 |
| 41 | `AddGoodsToAnyStock` | 1, 6, 7 | fill the player's warehouses that store the good, spilling to the next until the amount is placed | sim | 29 |
| 42 | `AllowGood` | 1, 3, 6 | allow the good for the player's tribe | sim | 34 |
| 43 | `EnableGood` | 1, 3, 6 | mark the good produceable for the player's tribe | sim | 101 |
| 44 | `ChangePlayerIdInArea` | 1, 2, 16, 17, 9 | hand everything of the first player within `range` to the second | sim | 134 |
| 45 | `SetDiplomacyNotChangeableFlag` | 1, 2, 32 | set or clear the pair's not-changeable flag in both directions; the stance setter only silences its message for a flagged pair, so the lock binds in the diplomacy window (not examined) | sim | 189 |
| 46 | `RemoveFXWaveLandscapeInArea` | 16, 17, 9 | remove `fx wave` landscapes within `range` | sim | 0 |
| 47 | `1 Open/0 CloseWallGate` | 1, 16, 17, 32 | open or close the player's wall gate at the point | sim | 14 |
| 48 | `Mission quit and play video` | 7 | request the FMV `Seq_NNNN` at exit (out of scope: game video) | app | 0 |
| 49 | `SetPlayerBehaviourFlag` | 1, 7, 32 | OR or clear the mask on every current human of the player | sim | 240 |
| 50 | `SetHumanBehaviourFlag` | 10, 7, 32 | OR or clear the mask on humans with the id | sim | 436 |
| 51 | `SetRandomChestOnRandomPos` | 7 | drop a random chest of the category somewhere | sim | 0 |
| 52 | `RemoveHumansNearPos` | 16, 17, 9 | mark every human within `range` for removal | sim | 20 |
| 53 | `StopHumanByPlayerId` | 1 | stop every walking human of the player and reset its work target | sim | 45 |
| 54 | `SetAnimal` | 1, 3, 4, 16, 17, 14, 29 | spawn an animal with the id and behaviour | sim | 591 |
| 55 | `RemoveAnimals` | 14 | remove every animal with the id, silently | sim | 22 |
| 56 | `ChangeHumanObjectIdInArea` | 1, 16, 17, 9, 10 | give the player's humans within `range` the id | sim | 16 |
| 57 | `HealHumansInArea` | 16, 17, 9 | set every human within `range` to full hit points | sim | 31 |
| 58 | `ClearTribute` | 28 | close the tribute slot; its data stays for a later `CreateTribute` to replace (reading) | sim | 818 |
| 59 | `SetGuiMarker` | 14, 16, 17 | show a marker of the given kind at the point | app | 20 |
| 60 | `SetHumanName` | 10, 27 | name the first human with the id from the string table | app | 138 |
| 61 | `SetWeather` | 16, 17, 9, 32, 7 | enable or disable a weather effect over the square of half-side `range` | app | 207 |
| 62 | `StartEarthQuake` | 35 | shake for `seconds`, with its sound | app | 122 |
| 63 | `SelectHuman` | 10, 32 | select the first human with the id | app | 7 |
| 64 | `AddGoodsToMapArea` | 6, 7, 16, 17, 9, 32, 1 | drop goods on the ground, spiralling outward from the point until the amount is placed; with the flag, the player's finished house standing on a point takes its fill first | sim | 206 |
| 65 | `RemoveGoodsFromMapArea` | 6, 7, 16, 17, 9, 32, 1 | pick goods up the same way; with the flag, out of the player's houses' own stock first | sim | 31 |
| 66 | `ChangeMissionIdOfHumanInRange` | 1, 10, 16, 17, 9 | give the player's humans within `range` the id | sim | 39 |
| 67 | `ChangeMissionIdOfPlayer` | 1, 10 | give every human of the player the id | sim | 1 |
| 68 | `SetVertexColor` | 16, 17, 9, 7 | tint the terrain within `range` | app | 413 |
| 69 | `RemoveLandscapesInArea` | 16, 17, 9 | clear landscape objects within `range` | sim | 11 |
| 70 | `MoveUnitsInArea` | 1, 16, 17, 9, 36, 37 | teleport up to 20 free humans and the vehicles of the player from within `range` of the first point to near the second, when the second lies farther than `range` | sim | 346 |
| 71 | `SetHouseExtensionLevel` | 14, 7 | rebuild up to 10 houses with the id at the new level in place | sim | 1 |
| 72 | `InfoClear` | 1, 36 | clear the on-screen info line | app | 202 |
| 73 | `InfoShowString` | 1, 36, 27 | show the string on the line | app | 112 |
| 74 | `InfoCountGoodsInArea` | 1, 36, 27, 6, 16, 17, 9, 37 | show the string with a live count of goods on the ground and in houses within `range` | app | 11 |
| 75 | `InfoCountHousesInArea` | 1, 36, 27, 15, 16, 17, 9, 37 | live count of finished houses of the type | app | 0 |
| 76 | `InfoCountHumenInArea` | 1, 36, 27, 16, 17, 9, 37 | live count of humans | app | 0 |
| 77 | `InfoCountSoldiersInArea` | 1, 36, 27, 16, 17, 9, 37 | live count of soldiers | app | 0 |
| 78 | `InfoCountAnimalsInArea` | 1, 36, 27, 3, 16, 17, 9, 37 | live count of animals of the species | app | 8 |
| 79 | `RemoveFXSmokeLandscapeInArea` | 16, 17, 9 | remove fire, smoke, fog, and wave effect landscapes within `range` | sim | 1 |
| 80 | `ChangeAnimalPlayerIdInArea` | 1, 3, 16, 17, 9, 7, 2 | hand up to `amount` (0: all, cap 50) animals of the species within `range` to the second player | sim | 6 |
| 81 | `RemoveHPsOfHousesInArea` | 1, 16, 17, 9, 7 | take `hp` from up to 100 houses of the player within `range` unless the house is indestructible; floor at zero | sim | 99 |
| 82 | `RemoveBlockerLandscapeInArea` | 16, 17, 9 | remove `block` landscapes within `range` | sim | 1 |
| 83 | `RemoveFX1LandscapeInArea` | 16, 17, 9 | remove fog and waterfall effects within `range` | sim | 1 |
| 84 | `RemoveFX2LandscapeInArea` | 16, 17, 9 | remove fire and smoke effects within `range` | sim | 1 |
| 85 | `SetCameraPosition` | 16, 17 | move the camera | app | 197 |
| 86 | `SetHumanX` | 1, 3, 4, 16, 17, 10, 29, 7 | `SetHuman` repeated `count` times | sim | 1371 |
| 87 | `RemoveHPsOfHousesInAreaX` | 1, 16, 17, 9, 7, 14 | as 81, skipping houses with the id | sim | 0 |
| 88 | `SetHouseOverlayState` | 14, 37, 32 | toggle a landscape overlay on houses with the id | app | 0 |
| 89 | `AttachHumanToVehicle` | 10, 12 | order humans with the id to board the first vehicle with the vehicle id when allowed | sim | 77 |
| 90 | `DetachHumanFromVehicle` | 10 | order humans with the id to leave their vehicle | sim | 74 |
| 91 | `SetHouseBuildForbiddenArea` | 16, 17, 9, 32 | forbid or allow building within `range` | sim | 150 |
| 92 | `MoveHuman` | 10, 16, 17 | teleport up to 20 humans with the id to the point, then let them settle with a walk order; explores around the destination | sim | 166 |
| 93 | `SetHouseBehaviourFlag` | 14, 36, 32 | set or clear bit `index` on houses with the id | sim | 113 |
| 94 | `ChangeMissionIdOfVehiclesInRange` | 1, 12, 16, 17, 9 | give the player's vehicles within `range` the id | sim | 0 |
| 95 | `RemoveVehiclesWithMissionId` | 12, 32 | remove vehicles with the id, and their crews when the flag is set | sim | 0 |
| 96 | `SetImportLandscapeMarker` | 16, 17, 32 | place or remove an import marker at the point | app | 0 |
| 97 | `SetVertexColorOnLand` | 16, 17, 9, 7 | tint land within `range` | app | 17 |
| 98 | `ChangeMissionIdOfPlayersVehiclesOnContinent` | 1, 16, 17, 12 | give the player's vehicles on the continent of the point the id | sim | 0 |
| 99 | `ChangeMissionIdOfVehicles` | 12, 36 | renumber vehicles from one id to another | sim | 12 |
| 100 | `SetRandomChestOnPosition` | 7, 16, 17 | drop a random chest of the category at the point | sim | 41 |
| 101 | `SetMapAreaMarker` | 16, 17, 9, 32, 36 | place or remove an area marker | app | 0 |
| 102 | `SetMapAreaMarkerMagic` | 16, 17, 9, 32, 36 | the magic-styled variant | app | 7 |

Chest categories for 51 and 100 are a bitmask (docs): 1 soldiers, 2 tower, 4 catapult, 8 goods,
16 buildings, 64 potions, 128 amulets, 256 wolves, 512 armours, 1024 lions.

The corpus never uses goals 8, 10, 14, 15, 16, 17, 23, 33, 44, 49, 60, 61, 62 and results 14, 15, 46,
48, 51, 75, 76, 77, 87, 88, 94, 95, 96, 98, 101. Twenty result opcodes cover 82 percent of all result
lines.

Eight opcode names in the corpus match no table entry, so the original runs them as `True` or `None`:
`NumberOfHumansNearPos` (12 goal lines, a goal the reference does not list either), `BuildHouse` (1),
and the results `MissionMissionFailed` (8), `DisableMission` (4), `SetLandspace` (4), `Disable All`
(3), `AddGoodsToHouse` (2) and one mangled `'ExploreArea"`. Case and spacing variants
(`timegone`, `EndSubmission`, `StartEarthQuake`) are not among them: matching ignores case.

## Human behaviour flags

`sethuman`'s last column, `SetHuman`'s seventh parameter, and the two `*BehaviourFlag` results share
one 32-bit mask stored on the human (reading; the `SetImportHumanFlag` result sets bit 7, which pins
the encoding). Bits with a located reader (reading; each is a hypothesis to confirm on the original):

| Bit | Value | Effect |
| --- | --- | --- |
| 0 | 1 | needs never grow and are never serviced (the engine sets it on player 0 in one game mode) |
| 1 | 2 | stays put when idle instead of drifting back to its anchor |
| 2 | 4 | passive: a soldier does not retaliate when hit, a civilian does not flee |
| 3 | 8 | invulnerable: a hit-point event that would take life off is refused while healing still lands; animals ignore the human |
| 4 | 16 | user messages about the human are suppressed |
| 5 | 32 | not player-controllable: no command set, ignored by send-to; the AI treats such humans as its own |
| 6 | 64 | cannot change job |
| 7 | 128 | import marker (drawn on the human) |
| 9 | 512 | walks at half speed |
| 11 | 2048 | earns no job experience |
| 12 | 4096 | stamina does not drain while walking |
| 13 | 8192 | aggressive target search; also hidden from animal aggression |
| 14 | 16384 | leaves no cadaver |
| 15 | 32768 | a hit does not spread to nearby units |
| 16 | 65536 | for the two non-settler tribes: alert military mode instead of the default |
| 17 | 131072 | walks faster |

Bit 0 is read twice: the urgent-needs check skips such a human, and the animation-event applier
refuses every change to its four need bars, so they neither fall nor refill.

Bits 8, 10, 18, and 19 appear in the corpus (masks 548897, 524328, 272507) without a located
reader. The engine sets 0x1800 plus bits 0 and 6, and bit 7 for one tribe, on the special soldier jobs
it spawns. Corpus masks: `sethuman` mostly 0, then 272507, 8315, 64; `SetPlayerBehaviourFlag` mostly
512, 131200, 16384, 8192; `SetHumanBehaviourFlag` mostly 32, 512, 33, 128, 8.

Houses keep their own mask; only bit 0 has a reader: an indestructible house ignores weapon hits and
script damage (reading). `SetHouseBehaviourFlag` takes a bit index, not a mask. The animal behaviour
value is stored on the animal; its readers were not examined.

## Player state the goals read

Readings unless marked otherwise.

- **Humans died, soldiers died**: incremented per owner when a human object exits, except during a
  script removal. Dying humans drop their carried good and worn equipment and leave a cadaver
  landscape unless bit 14 is set.
- **Humans killed**: two counters per player (soldiers, civilians), incremented for the attacker when
  a hit takes a victim below one hit point. Houses destroyed have a third counter that no goal reads.
- **Attacked by**: the damage callback of a human whose computed damage is above zero, shield or no
  shield, marks the attacker in the victim's row, one direction. The same callback escalates the
  victim's stance to enemy when the attacker already treats the victim as an enemy and the victim
  still treats the attacker as friend or neutral, with no regard to the not-changeable flag. This
  build keeps the row in `components/relations.ts`, written by the hit resolution.
- **Player dead**: every 125 ticks after tick 720, a player with no living adult male human is marked
  dead (a died callback and a message follow) unless `playerneverdies` is set in `[playermisc]`. The
  flag is permanent. `MissionFailed` does not set it. This build reads the match rule's dead flag.
- **Won, lost**: `MissionWon` and `MissionFailed` set one won and one lost flag on the mission manager,
  not per player, and hand the player to the notification. This build records the verdict per player
  (`components/match.ts`), which the match outcome and the end-of-match panel read.
- **Seen**: the setter was not located; the hypothesis is the vision update when a unit or building of
  the other player enters view. Needs an observation or a further reading. This build reads the vision
  system's first-contact record under fog, and everyone as seen with fog off (approximation).
- **Diplomacy**: a per-player matrix, one direction per entry; scripts issue both directions when they
  want symmetry (corpus). The not-changeable flag is symmetric and silences stance messages; this
  build keeps it in `components/relations.ts`, with no seat command yet that would have to respect it.
- **External flags**: up to 100 condition slots on a seat's AI handler; a slot takes a script's flag
  only when its `ai.inc` condition is the external-activate kind. This build keeps the raised slots per
  player (`components/ai-flags.ts`) for the day that condition layer is modelled; nothing reads them.
- **Allowed and enabled tables**: per player and tribe: 56 job, 66 good and 55 house-type slots,
  one byte each in an allowed table and an enabled table (produceable for goods). Allowed is the
  map's permission: the per-human update that opens a trade, a good or a house type for a settler
  (its experience or education permitting, or an AI seat) first requires the player's allowed byte,
  and `Allow*` writes it. Enabled is the tech-tree progress that update records once any settler of
  the player gained the ability, with a "new ability" message; `Enable*` writes it outright, a chest
  reward writes the produceable byte the same way, and `JobEnabled` and `GoodProduceable` read it.
  This build keeps both tables per player and tribe (`components/unlocks.ts`): the enabled ones OR
  into the living-trade gates, the allowed ones have no reader, because the content catalog is the
  only permission it models (approximation).
- **Explored**: a 16-bit per-map-point mask, one bit per player up to player 15. This build answers
  from its per-cell fog masks: explored everywhere with fog off, known terrain counting in RECON, and a
  script reveal writes EXPLORED without downgrading a VISIBLE cell.

## Tributes

A reading of the tribute manager, which the goal `PayTribute` and results 27, 28, and 58 drive.

- 44 slots (the corpus addresses 0 to 39). A slot holds: active flag, paid flag, payer, receiver,
  description string id, and up to 5 demands (good, amount). `CreateTribute` initialises the slot as
  active and paid with no demands and the string id from the fourth parameter. `AddTributeGoods` adds
  to an existing demand or appends a new one, drops a sixth kind, and clears the paid flag; the
  manager skips it on an inactive slot. `ClearTribute` clears the active flag and nothing else.
- Where it shows: the diplomacy window, under the selected player's tab, lists every active unpaid
  slot from the viewer to that player as one button: the description from the map's string table
  (`"<MISSION STRINGS NOT LOADED>"` without one), then each demand as `amount good (have "in stores")`,
  where "have" is the payer's warehouses and workplaces summed. The button is disabled unless the
  slot is payable, and pressing it sends the pay network command for the slot. The window iterator
  walks slots 0 to 39 only.
- Payable: one single warehouse or workplace of the payer holds every demanded amount in full,
  counted like the goal counts (a workplace's product slots, never its inputs). A food demand is met
  by the first good of the same food class (simple or extra) the house stores, walking the food
  goods in id order (`food_simple` and `food_extra` first, then the dishes), so a warehouse pays
  bread out of its `food_simple` and a bakery out of its bread. A slot demanding nothing is payable
  by any such house standing.
- Paying takes goods out of a copy of the demands, house by house until every demand reaches zero:
  the first house of the headquarters type, then every warehouse in array order, then every
  workplace, each giving what it holds of what is still owed, so a payment can drain several houses
  although one held everything. The slot's own demand amounts are untouched; only the paid flag is
  set. The receiver gets nothing (the goods vanish). The command does not check who sent it.
- `PayTribute n` holds when slot `n` is active and paid.
- This build keeps the table in `components/tributes.ts`, pays it through the `payTribute` seat
  command (`systems/missions/tributes.ts`) and lists it in the diplomacy window, with the same rule
  and drain order over finished storages then workplaces, each ascending by entity id
  (approximation: no house type is drained first, since no content role marks the headquarters); the
  food class is the dish table of `readviews/food.ts`. Two demands a house meets with the same
  stocked good are checked as their sum, where the original checks each alone and would mark a slot
  paid with part of it still owed (deviation). The seat command is admitted only for the slot's
  payer, and only while the slot is open, unpaid and payable. The window lists all 44 slots where
  the original's walks 40 (unreachable in the corpus), under a discovered roster player, which every
  corpus receiver is, and notes a slot the stores hold in sum but no single one can pay.

## On-screen info lines

Five lines per player, twenty players, plus broadcast (player 20 or -1 writes every existing player).
A line is cleared, a plain string, or a string with a live count (goods, houses, humans, soldiers,
animals in an area) substituted into the string's `%d` (reading). The window that draws them was not
examined; the docs place them at the top right.

## Briefings and the mission window

`PlayCutscene id replay` opens `text/<lang>/briefings/<id as 4 digits>.hlt` in the mission window's
hypertext element, remembers up to 50 shown page ids as history, and, when `replay` is set, stores
`id` as the page the window's "mission" tab shows again later (reading). The window's goal strings
come from the map's string table; how it filters and marks missions (the `visible` flag, the
per-mission "evaluated true" flag, `description`) needs a reading of its draw routine or an
observation. The app-side page format is documented with the `.briefing.json` sidecar schema in
`packages/data`.

## Sub-missions

`StartSubMission campaign map` saves the running game to a temporary slot, loads the clean campaign
map at the current difficulty, and embeds the saved parent inside the new game; `EndSubMission`
restores the embedded parent and discards the temporary slot (reading). A sub-mission is therefore a
separate world with the parent frozen, not a shared map. `AllowMap` and `CloseMap` toggle campaign map
availability.

## Multiplayer goals

`[misc_multiplayer_goals]` (9 corpus maps) feeds a separate manager checked every 120 ticks
(reading): goal type 1 loses when the player's dead flag is set, type 2 wins on good counts, type 3 on
an inhabitant or soldier count, type 4 wins when `MissionWon` fires for the player, type 5 loses when
`MissionFailed` fires. The multiplayer tickets own this manager.

## Open questions

- Confirm on the running original: the 3-second check period, `TimeGone` in whole seconds from
  activation, and the `[n/2, n)` range of `RandomTimeGone`.
- What sets a player's "seen" flag toward another player.
- Behaviour bits 8, 10, 18, 19 and the animal behaviour value.
- The mission window's listing rule and done marker.
- The loader's `description` default of 0 against the corpus convention of -1.
