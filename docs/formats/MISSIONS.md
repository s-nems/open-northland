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

Corpus size: 124 sidecars, all with missions; about 6,900 goal lines and 28,100 result lines. The
largest script (Walhalla) has 526 missions; a typical campaign map has 60 to 150.

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
(corpus, pipeline). Range tests use the original's hexagonal distance on that lattice.

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

The pipeline's extractor names the `setanimal` columns `<class> "<species>" "<age>"`; the engine
writes them as player (20 for wild), tribe, and animal type. Corpus: 154 `sethouse` lines in plaintext maps carry ids 0, 69, 905, 915, and 1000 to 1004; 855
`sethuman` lines mostly use 0, 100 to 110, 200 to 203, 900, and 997; all 1,477 `setanimal` lines use
id 0. The generated sidecars hold 4,014 nonzero house ids in total. Ids are not unique: one id names
a group, and every lookup walks the whole entity array (reading), which is why a reimplementation
wants an id-to-entities index. Ids are also assigned at runtime by `SetHuman`, `SetHouse`, `SetAnimal`,
`SetVehicle`, the `ChangeMissionId*` results, and, as a side effect, by the `BuildHumans`,
`BuildHouses`, and `BuildVehicles` goals.

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
  results to loop (corpus: waves every N seconds).
- `RandomTimeGone n` draws once per activation from the game's random generator, uniformly in
  `[n/2, n)`, caches the draw in the goal record, and clears the cache when it fires, so the next
  activation draws again. A reimplementation must draw from the simulation's seeded generator.
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

Index and name from the engine table (reading), cross-checked with the docs and with every opcode the
corpus uses. Parameters list kinds in order. "Uses" counts corpus goal lines. Semantics are readings.

| # | Goal | Parameters | Holds when | Uses |
| --- | --- | --- | --- | --- |
| 0 | `True` | | always | 237 |
| 1 | `BuildVehicles` | 1, 5, 7, 12 | the player owns at least `amount` vehicles of the type; every match gets object id `arg4` | 3 |
| 2 | `BuildHumans` | 1, 4, 7, 10 | the player has at least `amount` humans with the job; every match gets object id `arg4` unless `arg4` is 12345 | 8 |
| 3 | `BuildHouses` | 1, 15, 7, 14 | the player owns at least `amount` finished houses of the type; every match gets object id `arg4` | 142 |
| 4 | `GoodsInVehicles` | 12, 6, 7 | vehicles with the id hold at least `amount` of the good in total | 2 |
| 5 | `GoodsInHouses` | 14, 6, 7 | houses with the id hold at least `amount` of the good in total | 39 |
| 6 | `GoodsGlobal` | 1, 6, 7 | the player's houses that can store the good hold at least `amount` in total | 21 |
| 7 | `FindPos` | 1, 16, 17 | the map point has been explored by the player (player 16 or more: always) | 45 |
| 8 | `FindHumans` | 1, 10 | any human with the id stands on a point explored by the player | 0 |
| 9 | `FindVehicles` | 1, 12 | as above for vehicles | 0 |
| 10 | `FindHouses` | 1, 14 | as above for houses | 0 |
| 11 | `FindPosByHumans` | 10, 16, 17, 9 | any human with the id is within `range` of the point | 626 |
| 12 | `FindPosByVehicles` | 12, 16, 17, 9 | as above for vehicles | 5 |
| 13 | `FindHumansByHumans` | 10, 11, 9 | any human with id A is within `range` of any human with id B | 13 |
| 14 | `FindHumansByVehicles` | 12, 10, 9 | any vehicle with id A is within `range` of any human with id B | 0 |
| 15 | `FindVehiclesByVehicles` | 12, 13, 9 | vehicle-to-vehicle range test | 0 |
| 16 | `FindHousesByHumans` | 10, 14, 9 | any human with id A is within `range` of any house with id B | 0 |
| 17 | `FindHousesByVehicles` | 12, 14, 9 | vehicle-to-house range test | 0 |
| 18 | `HumansDied` | 10 | no living human carries the id | 378 |
| 19 | `VehiclesDied` | 12 | no vehicle carries the id | 4 |
| 20 | `HousesDied` | 14 | no house carries the id | 58 |
| 21 | `PlayerDied` | 1 | the player's dead flag is set (see statistics) | 227 |
| 22 | `FindPosByPlayersMapMoveable` | 1, 16, 17, 9 | any human or vehicle of the player is within `range` of the point | 1023 |
| 23 | `BuildHouseOnContinent` | 1, 16, 17, 15 | the player has a finished house of the type on the continent of the point | 0 |
| 24 | `DiplomacyState` | 1, 2, 25 | the first player's stance toward the second equals the state | 86 |
| 25 | `HumansWithHome` | 1, 7 | at least `amount` adult humans of the player live in a finished home | 15 |
| 26 | `NumberOfSoldiers` | 1, 7 | the player has at least `amount` soldiers | 33 |
| 27 | `DetectGuide` | 1, 16, 17, 9 | the player has a guide (signpost) within `range` of the point | 1 |
| 28 | `TimeGone` | 35 | `seconds` of game time have passed since activation | 1741 |
| 29 | `CheckMission` | 21 | mission `n`'s goals hold now (evaluated without firing) | 0 |
| 30 | `PayTribute` | 28 | the tribute slot is active and fully paid | 692 |
| 31 | `Population` | 1, 7 | the player has at least `amount` humans of any age | 92 |
| 32 | `PlayerSeen` | 1, 2 | the first player has seen the second | 147 |
| 33 | `IsHumanInVehicle` | 10, 12 | every human with the id sits in a vehicle with the vehicle id | 0 |
| 34 | `FindHumansByPlayersMM` | 10, 1, 9 | any human with the id has a human or vehicle of the player within `range` | 22 |
| 35 | `SoldiersDied` | 1, 7 | at least `amount` soldiers of the player have died | 8 |
| 36 | `AnimalsDied` | 14 | no animal carries the id | 5 |
| 37 | `PlayerAttackedByPlayer` | 2, 1 | the first player has been attacked by the second | 7 |
| 38 | `JobEnabled` | 1, 3, 4 | the job is enabled for the player's tribe | 2 |
| 39 | `GoodProduceable` | 1, 3, 6 | the good is produceable for the player's tribe | 139 |
| 40 | `NumberOfHumansDied` | 1, 7 | at least `amount` humans of the player have died | 119 |
| 41 | `FindAnimals` | 1, 14 | any animal with the id stands on a point explored by the player | 1 |
| 42 | `NumberOfGoodsTraded` | 1, 2, 7 | the first player traded at least `amount` goods with the second | 5 |
| 43 | `HumanAttachedToWorkHouse` | 1, 4, 7 | at least `amount` humans of the player with the job are attached to a workplace | 4 |
| 44 | `CheckNumberOfWildAnimals` | 3, 7 | at least `amount` wild animals of the species | 0 |
| 45 | `RandomTimeGone` | 35 | a random `[n/2, n)` seconds have passed since activation | 30 |
| 46 | `IfMissionIsActive` | 21 | mission `n` is active | 280 |
| 47 | `NumberOfAnimals` | 1, 3, 7 | the player owns at least `amount` animals of the species | 0 |
| 48 | `NumberOfHumansKilled` | 1, 7 | the player has killed at least `amount` humans (soldiers plus civilians) | 5 |
| 49 | `HumanIsOnContinent` | 10, 16, 17 | any human with the id stands on the continent of the point | 0 |
| 50 | `IsMissionDone` | 21 | mission `n`'s stored goal flags satisfy its rule | 354 |
| 51 | `NumberOfSoldiersNearPos` | 1, 16, 17, 9, 7 | at least `amount` non-hero soldiers of the player within `range`, vehicle crews included | 22 |
| 52 | `NumberOfCivilainsNearPos` | 1, 16, 17, 9, 7 | as above for civilians | 3 |
| 53 | `ChestNearPos` | 16, 17, 9 | a chest landscape lies within `range` of the point | 1 |
| 54 | `NumberOfGoodsInArea` | 1, 6, 7, 16, 17, 9 | goods on the ground plus goods in the player's finished houses within `range` reach `amount` | 262 |
| 55 | `NumberOfHousesInArea` | 1, 15, 7, 16, 17, 9 | the player has at least `amount` finished houses of the type within `range` | 22 |
| 56 | `NumberOfGoodsInHousesInArea` | 1, 6, 7, 16, 17, 9 | goods in the player's finished houses within `range` reach `amount` | 30 |
| 57 | `NumberOfVehiclesInArea` | 1, 5, 7, 16, 17, 9 | the player has at least `amount` vehicles of the type within `range` | 3 |
| 58 | `NumberOfAnimalsInArea` | 1, 3, 7, 16, 17, 9 | the player has at least `amount` animals of the species within `range` | 5 |
| 59 | `CheckHumanJob` | 10, 4 | any human with the id has the job | 6 |
| 60 | `NumberOfGoodsInVehiclesInArea` | 1, 5, 6, 7, 16, 17, 9 | goods in the player's vehicles of the type within `range` reach `amount` | 0 |
| 61 | `IsAnyLandscapeOnPoint` | 16, 17 | the point carries a landscape object | 0 |
| 62 | `IsLandscapePlayer10ConstructionSignOnPoint` | 16, 17 | the point carries the `player10 construction sign` landscape | 0 |

Range tests use the original's hexagonal map-point distance. "Explored" is the per-player seen bit
of a map point, set once and never cleared (reading), which matches a reveal-style fog.

## Results

Same conventions. "Sim" marks results that change simulation state; "app" marks results that only
drive presentation and become events; "both" do some of each.

| # | Result | Parameters | Effect | Layer | Uses |
| --- | --- | --- | --- | --- | --- |
| 0 | `None` | | nothing | | 0 |
| 1 | `SetHuman` | 1, 3, 4, 16, 17, 10, 29 | spawn one human at the point with the id and behaviour flags | sim | 2885 |
| 2 | `SetVehicle` | 1, 3, 5, 16, 17, 12, 30 | spawn a vehicle; with the captain flag also spawn its commander at the door and board it | sim | 171 |
| 3 | `SetHouse` | 1, 19, 8, 20, 16, 17, 14 | place a house of the named type at the nearest buildable spot within 12 points, finished or as a construction site, with the id; warns when no spot exists | sim | 30 |
| 4 | `SetLandscape` | 16, 17, 18, 8, 32 | place the named landscape object at the point | sim | 761 |
| 5 | `RemoveHumans` | 10 | remove every human with the id, silently (no death statistics, no cadaver) | sim | 102 |
| 6 | `RemoveVehicles` | 12 | remove every vehicle with the id | sim | 7 |
| 7 | `RemoveHouses` | 14 | remove every house with the id | sim | 22 |
| 8 | `RemoveLandscape` | 16, 17 | clear the landscape object on the point | sim | 439 |
| 9 | `PlayCutscene` | 34, 33 | open briefing page `NNNN.hlt`; with the replay flag it becomes the page the mission window replays; stops the current pass; plays the briefing pop-up sound | app | 1400 |
| 10 | `ActivateMission` | 21 | set the active flag (records the activation tick on the transition) | sim | 5042 |
| 11 | `DeactivateMission` | 21 | clear the active flag | sim | 1898 |
| 12 | `MissionWon` | 1 | mark the map won, send the "won" message and notification; in multiplayer also trigger the multiplayer goal manager | both | 113 |
| 13 | `MissionFailed` | 1 | as above for "lost" | both | 111 |
| 14 | `AllowMap` | 31, 22 | unlock a campaign map | sim | 0 |
| 15 | `CloseMap` | 31, 22 | lock a campaign map | sim | 0 |
| 16 | `ExploreArea` | 1, 16, 17, 9 | reveal the area for the player; `0 0 0 0` (any zero x, y, or range) reveals the whole map | sim | 1493 |
| 17 | `Exit` | | leave the map (restart callback) | app | 8 |
| 18 | `SetExternalFlag` | 1, 24, 32 | set or clear an AI condition flag for the player (`ai.inc` states) | sim | 60 |
| 19 | `SetDiplomacy` | 1, 2, 25 | set the first player's stance toward the second (one direction only); the original sends a message unless the pair is marked not changeable | sim | 698 |
| 20 | `SetVisible` | 21, 32 | show or hide mission `n` in the mission window | app | 452 |
| 21 | `ChangeHumanPlayerId` | 10, 1 | hand every human with the id to the player (detached from houses) | sim | 267 |
| 22 | `ChangePlayerPlayerId` | 1, 2 | hand every vehicle, house, human, animal, and guide of the first player to the second | sim | 27 |
| 23 | `SendHuman` | 10, 16, 17 | order every human with the id to walk to the nearest unblocked point | sim | 705 |
| 24 | `SendVehicle` | 12, 16, 17 | order vehicles with the id to move there | sim | 50 |
| 25 | `DockVehicle` | 12, 16, 17 | order vehicles with the id to dock there | sim | 8 |
| 26 | `PlaySound` | 26, 16, 17 | play the sound effect at the point | app | 558 |
| 27 | `CreateTribute` | 28, 1, 2, 27 | open tribute slot `n` from the first player to the second with the description string; starts paid and empty | sim | 986 |
| 28 | `AddTributeGoods` | 28, 6, 7 | add a demand (up to 5 kinds per slot); marks the slot unpaid | sim | 1118 |
| 29 | `AllowJob` | 1, 3, 4 | allow the job for the player's tribe and refresh its humans | sim | 0 |
| 30 | `AllowHouse` | 1, 3, 15 | allow the house type for the player's tribe | sim | 13 |
| 31 | `AddGoodsToHouses` | 14, 6, 7 | add the amount to every house with the id that can store the good | sim | 933 |
| 32 | `StartSubMission` | 31, 22 | after the pass: save the game, load the campaign sub map, embed the save | sim | 21 |
| 33 | `EndSubMission` | | after the pass: restore the embedded parent game | sim | 26 |
| 34 | `ChangeVehiclesPlayerId` | 12, 1 | hand vehicles with the id to the player | sim | 8 |
| 35 | `ChangeHousesPlayerId` | 14, 1 | hand houses with the id to the player | sim | 46 |
| 36 | `SetImportHumanFlag` | 10, 32 | set or clear behaviour bit 7 on humans with the id | sim | 41 |
| 37 | `EnableJob` | 1, 3, 4 | enable the job for the player's tribe | sim | 19 |
| 38 | `EnableHouse` | 1, 3, 15 | enable the house type; the original also flips a few good flags for three specific house types (id-specific, approximate) | sim | 52 |
| 39 | `DisableAll` | | deactivate every mission | sim | 3 |
| 40 | `AddGoodsToVehicle` | 12, 6, 7 | add goods to vehicles with the id that can carry the good | sim | 2 |
| 41 | `AddGoodsToAnyStock` | 1, 6, 7 | fill the player's warehouses that store the good, spilling to the next until the amount is placed | sim | 72 |
| 42 | `AllowGood` | 1, 3, 6 | allow the good for the player's tribe | sim | 7 |
| 43 | `EnableGood` | 1, 3, 6 | mark the good produceable for the player's tribe | sim | 101 |
| 44 | `ChangePlayerIdInArea` | 1, 2, 16, 17, 9 | hand everything of the first player within `range` to the second | sim | 65 |
| 45 | `SetDiplomacyNotChangeableFlag` | 1, 2, 32 | lock the pair's stance in both directions (also silences stance messages) | sim | 189 |
| 46 | `RemoveFXWaveLandscapeInArea` | 16, 17, 9 | remove `fx wave` landscapes within `range` | sim | 0 |
| 47 | `1 Open/0 CloseWallGate` | 1, 16, 17, 32 | open or close the player's wall gate at the point | sim | 0 |
| 48 | `Mission quit and play video` | 7 | request the FMV `Seq_NNNN` at exit (out of scope: game video) | app | 0 |
| 49 | `SetPlayerBehaviourFlag` | 1, 7, 32 | OR or clear the mask on every current human of the player | sim | 240 |
| 50 | `SetHumanBehaviourFlag` | 10, 7, 32 | OR or clear the mask on humans with the id | sim | 444 |
| 51 | `SetRandomChestOnRandomPos` | 7 | drop a random chest of the category somewhere | sim | 0 |
| 52 | `RemoveHumansNearPos` | 16, 17, 9 | mark every human within `range` for removal | sim | 3 |
| 53 | `StopHumanByPlayerId` | 1 | stop every walking human of the player and reset its work target | sim | 22 |
| 54 | `SetAnimal` | 1, 3, 4, 16, 17, 14, 29 | spawn an animal with the id and behaviour | sim | 614 |
| 55 | `RemoveAnimals` | 14 | remove every animal with the id, silently | sim | 88 |
| 56 | `ChangeHumanObjectIdInArea` | 1, 16, 17, 9, 10 | give the player's humans within `range` the id | sim | 3 |
| 57 | `HealHumansInArea` | 16, 17, 9 | set every human within `range` to full hit points | sim | 8 |
| 58 | `ClearTribute` | 28 | close the tribute slot | sim | 821 |
| 59 | `SetGuiMarker` | 14, 16, 17 | show a marker of the given kind at the point | app | 6 |
| 60 | `SetHumanName` | 10, 27 | name the first human with the id from the string table | app | 146 |
| 61 | `SetWeather` | 16, 17, 9, 32, 7 | enable or disable a weather effect over the square of half-side `range` | app | 164 |
| 62 | `StartEarthquake` | 35 | shake for `seconds`, with its sound | app | 122 |
| 63 | `SelectHuman` | 10, 32 | select the first human with the id | app | 79 |
| 64 | `AddGoodsToMapArea` | 6, 7, 16, 17, 9, 32, 1 | drop goods on the ground, spiralling outward from the point until the amount is placed | sim | 368 |
| 65 | `RemoveGoodsFromMapArea` | 6, 7, 16, 17, 9, 32, 1 | pick goods up from the ground the same way | sim | 24 |
| 66 | `ChangeMissionIdOfHumanInRange` | 1, 10, 16, 17, 9 | give the player's humans within `range` the id | sim | 34 |
| 67 | `ChangeMissionIdOfPlayer` | 1, 10 | give every human of the player the id | sim | 11 |
| 68 | `SetVertexColor` | 16, 17, 9, 7 | tint the terrain within `range` | app | 428 |
| 69 | `RemoveLandscapesInArea` | 16, 17, 9 | clear landscape objects within `range` | sim | 55 |
| 70 | `MoveUnitsInArea` | 1, 16, 17, 9, 36, 37 | teleport up to 20 free humans and the vehicles of the player from within `range` of the first point to near the second, when the second lies farther than `range` | sim | 346 |
| 71 | `SetHouseExtensionLevel` | 14, 7 | rebuild up to 10 houses with the id at the new level in place | sim | 30 |
| 72 | `InfoClear` | 1, 36 | clear the on-screen info line | app | 202 |
| 73 | `InfoShowString` | 1, 36, 27 | show the string on the line | app | 112 |
| 74 | `InfoCountGoodsInArea` | 1, 36, 27, 6, 16, 17, 9, 37 | show the string with a live count of goods on the ground and in houses within `range` | app | 20 |
| 75 | `InfoCountHousesInArea` | 1, 36, 27, 15, 16, 17, 9, 37 | live count of finished houses of the type | app | 0 |
| 76 | `InfoCountHumenInArea` | 1, 36, 27, 16, 17, 9, 37 | live count of humans | app | 0 |
| 77 | `InfoCountSoldiersInArea` | 1, 36, 27, 16, 17, 9, 37 | live count of soldiers | app | 0 |
| 78 | `InfoCountAnimalsInArea` | 1, 36, 27, 3, 16, 17, 9, 37 | live count of animals of the species | app | 0 |
| 79 | `RemoveFXSmokeLandscapeInArea` | 16, 17, 9 | remove fire, smoke, fog, and wave effect landscapes within `range` | sim | 9 |
| 80 | `ChangeAnimalPlayerIdInArea` | 1, 3, 16, 17, 9, 7, 2 | hand up to `amount` (0: all, cap 50) animals of the species within `range` to the second player | sim | 44 |
| 81 | `RemoveHPsOfHousesInArea` | 1, 16, 17, 9, 7 | take `hp` from up to 100 houses of the player within `range` unless the house is indestructible; floor at zero | sim | 27 |
| 82 | `RemoveBlockerLandscapeInArea` | 16, 17, 9 | remove `block` landscapes within `range` | sim | 6 |
| 83 | `RemoveFX1LandscapeInArea` | 16, 17, 9 | remove fog and waterfall effects within `range` | sim | 9 |
| 84 | `RemoveFX2LandscapeInArea` | 16, 17, 9 | remove fire and smoke effects within `range` | sim | 5 |
| 85 | `SetCameraPosition` | 16, 17 | move the camera | app | 209 |
| 86 | `SetHumanX` | 1, 3, 4, 16, 17, 10, 29, 7 | `SetHuman` repeated `count` times | sim | 1580 |
| 87 | `RemoveHPsOfHousesInAreaX` | 1, 16, 17, 9, 7, 14 | as 81, skipping houses with the id | sim | 0 |
| 88 | `SetHouseOverlayState` | 14, 37, 32 | toggle a landscape overlay on houses with the id | app | 0 |
| 89 | `AttachHumanToVehicle` | 10, 12 | order humans with the id to board the first vehicle with the vehicle id when allowed | sim | 77 |
| 90 | `DetachHumanFromVehicle` | 10 | order humans with the id to leave their vehicle | sim | 21 |
| 91 | `SetHouseBuildForbiddenArea` | 16, 17, 9, 32 | forbid or allow building within `range` | sim | 158 |
| 92 | `MoveHuman` | 10, 16, 17 | teleport up to 20 humans with the id to the point, then let them settle with a walk order; explores around the destination | sim | 44 |
| 93 | `SetHouseBehaviourFlag` | 14, 36, 32 | set or clear bit `index` on houses with the id | sim | 113 |
| 94 | `ChangeMissionIdOfVehiclesInRange` | 1, 12, 16, 17, 9 | give the player's vehicles within `range` the id | sim | 0 |
| 95 | `RemoveVehiclesWithMissionId` | 12, 32 | remove vehicles with the id, and their crews when the flag is set | sim | 0 |
| 96 | `SetImportLandscapeMarker` | 16, 17, 32 | place or remove an import marker at the point | app | 0 |
| 97 | `SetVertexColorOnLand` | 16, 17, 9, 7 | tint land within `range` | app | 3 |
| 98 | `ChangeMissionIdOfPlayersVehiclesOnContinent` | 1, 16, 17, 12 | give the player's vehicles on the continent of the point the id | sim | 0 |
| 99 | `ChangeMissionIdOfVehicles` | 12, 36 | renumber vehicles from one id to another | sim | 3 |
| 100 | `SetRandomChestOnPosition` | 7, 16, 17 | drop a random chest of the category at the point | sim | 12 |
| 101 | `SetMapAreaMarker` | 16, 17, 9, 32, 36 | place or remove an area marker | app | 0 |
| 102 | `SetMapAreaMarkerMagic` | 16, 17, 9, 32, 36 | the magic-styled variant | app | 5 |

Chest categories for 51 and 100 are a bitmask (docs): 1 soldiers, 2 tower, 4 catapult, 8 goods,
16 buildings, 64 potions, 128 amulets, 256 wolves, 512 armours, 1024 lions.

The corpus never uses goals 8, 9, 10, 14, 15, 16, 17, 23, 29, 33, 44, 47, 49, 60, 61, 62 and results
14, 15, 29, 46, 47, 48, 51, 75, 76, 77, 78, 87, 88, 94, 95, 96, 98, 101. Twenty result opcodes cover
more than ninety percent of all result lines.

## Human behaviour flags

`sethuman`'s last column, `SetHuman`'s seventh parameter, and the two `*BehaviourFlag` results share
one 32-bit mask stored on the human (reading; the `SetImportHumanFlag` result sets bit 7, which pins
the encoding). Bits with a located reader (reading; each is a hypothesis to confirm on the original):

| Bit | Value | Effect |
| --- | --- | --- |
| 0 | 1 | needs never grow and are never serviced (the engine sets it on player 0 in one game mode) |
| 1 | 2 | stays put when idle instead of drifting back to its anchor |
| 2 | 4 | passive: a soldier does not retaliate when hit, a civilian does not flee |
| 3 | 8 | invulnerable: hit points neither drop nor regenerate; animals ignore the human |
| 4 | 16 | user messages about the human are suppressed |
| 5 | 32 | not player-controllable: no command set, ignored by send-to; the AI treats such humans as its own |
| 6 | 64 | cannot change job |
| 7 | 128 | import marker (drawn on the human) |
| 9 | 512 | walks at half speed |
| 12 | 4096 | stamina does not drain while walking |
| 13 | 8192 | aggressive target search; also hidden from animal aggression |
| 14 | 16384 | leaves no cadaver |
| 15 | 32768 | a hit does not spread to nearby units |
| 16 | 65536 | for the two non-settler tribes: alert military mode instead of the default |
| 17 | 131072 | walks faster |

Bits 8, 10, 11, 18, and 19 appear in the corpus (masks 548897, 524328, 272507) without a located
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
- **Attacked by**: set for the victim's owner and the attacker whenever a human is damaged. The same
  hook escalates the victim's stance to enemy when the attacker already treats the victim as an enemy
  and the victim still treats the attacker as friend or neutral.
- **Player dead**: every 125 ticks after tick 720, a player with no living adult male human is marked
  dead (a died callback and a message follow) unless `playerneverdies` is set in `[playermisc]`. The
  flag is permanent. `MissionFailed` does not set it.
- **Seen**: the setter was not located; the hypothesis is the vision update when a unit or building of
  the other player enters view. Needs an observation or a further reading.
- **Diplomacy**: a per-player matrix, one direction per entry; scripts issue both directions when they
  want symmetry (corpus). The not-changeable flag is symmetric and also silences stance messages.
- **Enabled and allowed tables**: per player and tribe: 56 job slots, 66 good slots, 55 house-type
  slots, one byte each for "allowed" and "enabled" (produceable for goods).
- **Explored**: a 16-bit per-map-point mask, one bit per player up to player 15.

## Tributes

A reading of the tribute manager, which the goal `PayTribute` and results 27, 28, and 58 drive.

- 44 slots. A slot holds: active flag, paid flag, payer, receiver, description string id, and up to 5
  demands (good, amount). `CreateTribute` initialises the slot as active and paid with no demands and
  the string id from the fourth parameter. `AddTributeGoods` adds to an existing demand or appends a
  new one and clears the paid flag. `ClearTribute` clears the active flag.
- Paying is a player action (a network command from the tribute window): the slot is payable only
  when one single warehouse or workplace of the payer holds every demanded amount in full. Payment
  then takes goods from the payer's houses in a fixed order until every demand reaches zero, and sets
  the paid flag. The receiver gets nothing (the goods vanish).
- `PayTribute n` holds when slot `n` is active and paid.

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
- Behaviour bits 8, 10, 11, 18, 19 and the animal behaviour value.
- The mission window's listing rule and done marker.
- The loader's `description` default of 0 against the corpus convention of -1.
