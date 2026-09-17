# Vehicles

Handcarts, ox carts, ships and catapults are one entity class in the original. This reference
holds the rules read from `Wonders.x64` (c2re, fully symbolled macOS build) and from the mod's
readable `.ini` files. Every rule below is byte-verified unless marked *inferred* or *open*.
Corpus counts are over the decoded `content/maps` of `CNMod-1.3.2` (123 maps). Tickets under
`docs/tickets/features/vehicles-*` implement this document; Open Northland approximations are named
where they are made. The IR carries the type table as `vehicles` (`VehicleType`, with `jobId`, the
slug `cart_no_ox` for type 6, `passengerJobs`, `vehicleSlots`, `passengerVector`,
`draggingAnimalTribe`, `transformVehicleType`, `hitpoints`), the yards as `vehicle`-kind buildings with
`vehicleType` and `ignoreContinents`, the good-to-yard pairing as `GoodType.vehicleHouse`, and the
sprites as `vehicleGraphics`.

## Type table (`Data/logic/vehicletypes.ini`)

Seven records, ids 1..6 (0 is "none"). `logicdefines.inc` names them `CART_HAND 1`, `CART_OX 2`,
`SHIP_SMALL 3`, `SHIP_BIG 4`, `CATAPULT 5`, `CART_NO_OX 6`. A vehicle also has a job id
`type + 49` (50..55): 52 and 53 are the ship jobs, 54 the catapult job.

| Key | Runtime meaning |
| --- | --- |
| `logicsize` | Clearance class the vehicle needs: a node is passable when its free-size class `>= logicsize`. Also the footprint radius (hex disc) and the ruin-scatter radius. Carts 0, catapult 1, ships 2. |
| `stockslots` | One shared unit budget across all goods (15, 30, 50, 200, catapult 0). |
| `logicgood n` | Storable good ids (1..55). Storage is a byte per allowed good: current, wanted, reserved. Goods 18, 19, 22 alias onto 16 and 20 onto 17 when not listed themselves. |
| `passengerslots` | Ordinary passenger slots. The commander occupies one extra slot at index `passengerslots`, so real capacity is `passengerslots + 1`. |
| `logicpassenger n` | Allowed job ids for attaching. The same list, indexed by a vehicle *job* id (50, 51, 54), says which vehicles a ship may carry. Catapult: 31..47 (soldiers and heroes). Ships: 5..47 plus 50, 51, 54 (the big ship lists no vehicle). Carts 1 and 2: 24, 25. The ox-less cart (6) lists none, so nobody can attach to it until its ox arrives. |
| `logiccommander n` | Parsed but no reader found (*inferred* dead). The commander is the first attached human with an allowed job. |
| `passengervector a b` | Door geometry: direction offset `a` from the facing, distance `b`. `b` is also the ring radius searched around a dock click (ships: 2 4). |
| `stockvector` | Parsed, no logic reader found (*open*; probably a render-side cargo point). |
| `vehicleslots` | Carried-vehicle slots: small ship 1, big ship 0. |
| `logicdragginganimaltribe` | Animal tribe the cart recruits (ox cart without ox: tribe 10). |
| `logictransformvehicleType` | Type the vehicle becomes when the animal arrives (6 -> 2). |

Hit points (table indexed by type): ship small 5000, ship big 5000, catapult 3000, everything
else 1000; the pipeline stamps the table onto `VehicleType.hitpoints`. Vision: 15 default, ship
small 20, ship big 25, catapult 20 (`CVehicle::Init`; Open Northland still gives every vehicle the
civilian radius, *open*). Vehicles have no armour.

## Construction

A workshop never stocks a vehicle good (59 handcart .. 63 catapult; `goodtypes.ini` marks them
`isProducedOnMapFlag 1`, `atomicForProduction 39`, though `prey` (56) shares that flag shape, so the
flag alone does not single them out). Each vehicle good pairs with a house type 42..46
(`logicmaintype 6`, `logicvehicletype n`, `logicworker 24 3`; the two ship houses also carry
`logicignorecontinentsflag 1`). The pairing in the IR follows the shared `VEHICLE_*` suffix of the
`GOOD_TYPE_` and `HOUSE_TYPE_` defines in `logicdefines.inc` (*inferred*: the engine's own join is
not byte-verified; the shipped ids pair 59..63 with 42..46 in order). House 43 (`oxcart`) spawns
type 6, the ox-less cart. The worker producing that good:

1. reuses an unfinished vehicle site within hex rings `r < 20` of the work centre, otherwise picks a
   build point within `r < 10` (5 and 10 for jobs 18 and 29) where every footprint node has
   free-size class `>= logicsize`, house placement is allowed, and no parked vehicle stands inside;
   with `logicignorecontinentsflag` the point's continent must differ from the worker's and the
   house work point must lie on the worker's continent, which is how a ship site lands on the water
   beside the shipyard;
2. fetches and carries the house's construction goods like building materials (the IR's
   `construction` list of houses 42..46: handcart 2 wood, ox cart 5 wood, small ship 5 leather +
   10 wood, big ship 5 leather + 15 wood, catapult 9 wood + 1 iron);
3. works on the site with the ordinary build animation;
4. when the site reaches the finished state the house is freed and a vehicle of `logicvehicletype`
   spawns at the house position for the same player and tribe, with mission id 0.

Failure reasons 8 (no spot) and 9 (a parked vehicle blocks every ring point) raise the
`vehicleSiteNotFound` / `vehicleSiteOccupied` messages. Chest kind `[` spawns a catapult for the
opener. Map scripts and `SetVehicle` are the other spawn sources.

Open Northland (`systems/settlers/drives/economy/vehicle-yard.ts`, `systems/footprint/placement/vehicle-site.ts`):
the operator's craft rotation treats a vehicle good as a turn taken outside on the yard site, never as a
cycle, and moves past it once the site launched; the site is a `SiteAssignment` crew membership like a
builder's, the yard's bill is fetched through the ordinary site-supply rungs, and builders and haulers
never serve a vehicle site. Approximations: which product a worker "currently" makes is the rotation
cursor (the original's scheduling is not decoded); the work point is the house door for both hammering
and the ship site's shore test, so "a water continent bordering the worker's continent" reduces to the
door lying on the worker's land component; a ship site needs the water side of the shared free-size field to admit
`logicsize` at every body node, all on one water body; a parked vehicle counts as reason 9 only when it stands on the house body, since a
vehicle is also a placement obstacle for the reserved margin; a failed search parks the worker for the
failed-goal memo's span before it looks again; the finished site leaves without a collapse event and
heaps any surplus delivered past the bill. The chest catapult takes the opener's tribe.

## Crew

- Attach (human command 0x26; payload vehicle index + unique id): same player, job in
  `logicpassenger`, and either no commander yet or a free ordinary slot. No distance check. The
  human leaves his work house, drops attack targets and walks to the vehicle. Attaching to another
  vehicle detaches first.
- The first attached human fills the commander slot; detaching the commander promotes the first
  remaining allowed-job passenger. No commander means the vehicle cannot move, dock or fire.
- Detach (0x27): refused for a ship not moored; a vehicle riding a carrier is sent out first; the
  human is put on the door cell. Several ordinary human commands force a detach first.
- Board (0x28, "moves inside"): succeeds only when the human stands on the door point. Aboard, the
  human is removed from the map (`IsInVehicle`). Leaving happens on the door cell, which for a
  moored ship is its mooring point on the shore.
- Boarding drive: for every slot the vehicle sends 0x28 to a passenger on the door's continent and
  0x27 to one on another continent (stragglers are dropped, not awaited). A passenger with a
  pending need blocks boarding. Task 3 "waits for human" while anyone is outside.
- Carried vehicles: a small ship takes one cart or catapult (`q` load into carrier, `s` move
  inside, `r` leave). `Passengers_CanVehicleMoveIn`: the carrier is a moored ship with a slot for
  it, the vehicle stands on the continent of the carrier's door, and the vehicle's crew count fits
  the carrier's free passenger room; the crew stays seated in the carried vehicle. The vehicle's
  task 6 boards its own crew first, drives to the carrier's door and enters there; a failed
  `CanVehicleMoveIn` raises 0x36 and a missing entry point 0x38, each followed by a detach.
- Messages: the human's attach refusal and detach refusal raise their own ids; the human's
  move-inside task raises 0x2b when its vehicle is a ship that is not moored; a carried vehicle
  that fails to detach raises 0x39. A human detaching from a ship at sea is refused silently.

Open Northland: `Rider` (`packages/sim/src/components/vehicle.ts`) marks an attached settler and the
seat's `inside` says whether it is aboard; a rider aboard has no `Position`, which is what keeps it
out of every map query, and its needs and hitpoints stand still (approximation: the original's
hitpoint step aboard is not read). `attachToVehicle` walks the rider to the door through the
unconfined walk order; the rider rung of the drive ladder (`systems/vehicles/boarding.ts`) keeps it
by the door and steps it in once the vehicle asks. A goto with anyone outside holds its goal under
`waitsForHuman` and starts once the crew is inside, the way `DoUpdateAI` runs `l_Passengers_MoveIn`
ahead of a target. `loadIntoVehicle` is `q` and `s` in one order. Named approximations: the job and
owner refusals of attach raise `cannotEnterVehicle` and a full vehicle `vehicleNoPassengerRoom`; a
refused load raises `cannotAttachVehicle`, which the original never raises; a rider refused off a
ship at sea raises `cannotLeaveVehicle`; a rider boards from the door node or, where a footprint
covers it, the nearest open node beside it; a rider whose walk to the door fails is dropped with a
lost note; the ordinary orders that detach first are the walk, attack, work, trade, home, school,
drill, marriage, need, equipment, explore, signpost and chest orders; a commander detaching mid-drive
leaves the drive running.

## Cargo

Wanted amounts are the per-vehicle request list. `Stock_ModifyAmount` clamps to capacity, refuses
negative stock and, when not riding a carrier, sets wanted to the new actual amount. Carriers
(job 24) serve a vehicle whose `wanted > reserved` for any good: they search loose goods within
radius 40 of the door, then a house, then the guide network, and carry one unit to the door.
Unload (`f`) has the carrier flush one reserved unit at a time out of the vehicle. The vehicle
window edits wanted by 1 (10 with Shift), clamped to `[0, stockslots]`, and clears all wanted.

Open Northland: `VehicleStock` (`packages/sim/src/components/vehicle.ts`) keeps the three bytes per
canonical good and `modifyVehicleStock` applies the clamp. The alias goes through the shared
dish-to-edible seam, which also maps meat and sausage (approximation: the original's table lists
neither).

## Movement

One navigation graph. A node is passable for a vehicle when its blocked bit is clear and its
free-size class (3 bits per node; how the original computes it is *open*) is `>= logicsize`.
A goto (`e`) needs a commander (`l_Error_NoCommander`) and silently ignores a target whose continent
id differs from the vehicle's or whose size class is below `logicsize`, which keeps ships on their
sea and carts on their landmass (continent type 1 is land). The walk starts with
`Pathfinder_Start(goal, 60, ...)`, the vehicle twin of the humans' 50/63 walk range; a failed
search raises message 0x32 and re-aims the vehicle at its current node. Humans inside the
footprint are shoved away on every node reached (`l_SendAwayRadial`). Per node the move period is
`max(3, (g*2 + 4) << catapult)` ticks with `g` the 4-bit ground speed class stored beside the size
class in the node record (`CVehicle::WalkSpeed_Update`); each tick adds `(period + 9999) / period`
to a per-node counter that completes at 10000, and the map position moves at 5000. The catapult is
the only vehicle with the doubling; a turn costs 2 ticks per hexagon direction. `p` stops (task 5
"interrupted") and returns to the current node.

Open Northland: one `TerrainGraph` carries both mover classes (`Traversal`, `nav/terrain`): a
settler, cart or catapult walks the land nodes, a ship sails the water nodes (unwalkable ground no
land vertex claims), and the static component labels land and water bodies in one key space, land
first, so the goto's continent test and the dock ring search compare the same key on either side.
The free-size class is the largest hex-disc radius of open same-continent nodes around the node,
capped at 7, one field for land and water (`nav/clearance.ts`); `g` reads 0 everywhere until the
map's roughness lane is imported (`TerrainGraph.groundSpeedClass`); the walk range is a hexagon
distance gate on the goto; an off-continent or out-of-range target raises `vehicleNoPath` instead of
being ignored; the anchor and footprint move at the start of a leg, not halfway, and the vehicle faces
the hexagon direction its lattice step is made of with no turning delay; parked vehicles' cells are
routed around, the shove happens on entering a node only and sends a settler outside the discs of
the whole remaining route. A real map's water is the cells whose two ground triangles are both
`isWater` pattern types (approximation of the per-node rule; an unknown or border pattern counts as
land, so a ship never sails onto the map edge).

## Ships and docking

Ships never attack. A ship spawns moored when a land continent borders it within
`passengervector[1]` steps, otherwise with no mooring point. Dock (`g`) on a land point
(`DoExecuteUserCommand_Dock`): needs a commander; a moored ship runs `l_Passengers_MoveIn` first
and the order waits while anyone is outside; then it scans the hex ring of exactly radius
`passengervector[1]` around the point, starting `passengervector[1]` steps north-west and turning
through the six directions, for a non-border node whose continent byte equals the ship's own and
whose size class is `>= logicsize`, and starts the walk (`l_StartAtomicWalk` with range 60) to the
first that takes it; the walk sets task 1 "docks" and stores the *clicked point* as the mooring
point. A ring node that is the ship's own position ends the order with nothing set. When no ring
node takes the walk, a ship with its commander inside raises 0x32; without one it stores the point
and plays the dock clip in place. Every node reached clears the moored flag
(`DoNewMapPositionReached`), and so does every walk start; on the last node of a dock walk the dock
clip (atomic 84) plays, and when it ends `CurrentTask_DoPerform` clears the task and sets the
moored flag. A goto arrival with no commander inside re-moors the ship when a land continent borders
the ring (`l_GetLandContinentIdFromBorder`); with the commander inside it stays at sea. No message is
raised on arrival. No port building is involved. The bas-c label `IsShipAtSea` is inverted: it is
the moored flag. Unload people (`f` on a ship) empties the crew onto the door cell only when it is on
land. When a vehicle leaves the map with its door on land, riders who are aboard are put on the door
cell and riders still walking to it are only detached where they stand (`Passengers_MoveOut_h`), and
a carried vehicle is set down on the door cell (`Passengers_MoveOut_v`); with the door at sea the
crew dies and a carried vehicle is removed with the ship. Ships leave no wreck and no cargo.

Open Northland: a spawned ship's mooring point is the nearest walkable node in hexagon-ring order
within the door distance; the door direction adds the vector's offset to the vehicle's facing in the
six map-point directions (approximation: the vehicle facing space is not read). Which node the
original stores as the spawn mooring is *open*. `dockVehicle` (`systems/vehicles/dock.ts`) holds the
point under the `docks` task while the crew boards, the twin of the goto's `waitsForHuman` hold; a
ring node is open when the ship's walk-block admits it, which adds other vehicles' cells to the size
class test; a ship already on a ring node moors in place (approximation: the original ends the order
with nothing set); no ring node raises `vehicleNoPath` whether or not the commander is inside; the
ship moors on the arrival tick with a `vehicleDocked` event, since the dock clip has no graphics
record and its length is not read; a goto clears the pending mooring point and never re-moors on
arrival (the commander-less re-mooring is not implemented, a goto needs a commander anyway); a dock
walk that loses its route drops the mooring point behind the `vehicleNoPath` note. A sunk ship's
crew is reaped like any death, so the owner's casualty tallies count it.

## Catapult

Crew: one soldier or hero (jobs 31..47); the crewman gains experience for weapon 21. Weapon 21
(`weapons.ini`, equal for all tribes): range 8..24, munition type 2, speed 3, `hitself 1`,
`createsmoke 1` lifetime 20, damage `0:8000 1:4000 2:6000 3:2000 4:2000 6:350 7:3625`, hit
sound 90. No ammunition and no reload counter; cadence is the 48-tick attack clip.

Stances (init 3): 3 hold = scan 8..24 around the guard position, never reposition; 2 defence =
scan 0..40 around the guard position, abandon the chase beyond 60; 1 attack = scan 0..40 around
the current position. The command-to-stance mapping is *inferred*. Targeting prefers enemy units in
buildings, then enemy houses, keeping the nearer of the new and current target; too close backs off,
in range fires, too far approaches.

Firing uses the shared delayed weapon-hit path of archers: at clip tick 1 the scatter roll
`r = rand % 100` against `accuracy = commanderSkill + 10` offsets the impact by up to
`(r - accuracy) * (dist / 4) / r` per axis when `r >= accuracy`; flight ticks `dist * 8 / speed`;
the hit list covers humans, animals, houses, vehicles and landscape, including the owner's own
(`hitself`). Only weapon 21 demolishes landscape of main type 4 (walls): subtype `> 2` transitions
to the next stage, else the node is cleared.

Damage to any vehicle: `damage[6] * 200 / (200 - min(armour, 100))`, armour 0, halved for
player 0 on easy. At 0 hit points the vehicle is removed; carts and catapults scatter ruin
landscape on 51 % of footprint nodes and drop all cargo within radius 10.

Both effects are gated in `CVehicle::Exit` on two global flags that every script removal sets, so
a scripted removal draws no ruins, spills nothing and draws no random number; a player leaving the
game (`Player_LeftGameModifyObjects`) removes his vehicles with ruins but without the cargo spill.

Open Northland: `removeVehicle` (`packages/sim/src/systems/vehicles/remove.ts`) draws the ruin
nodes through the seeded RNG and carries them on the `vehicleDestroyed` event for the renderer's
decals, since the ruin landscape type is not identified (*open*); the cargo spill walks the shared
Manhattan spill rings (approximation). The match rule's defeat teardown reuses the leave-game path,
ruins without cargo (approximation: the original's dead-player teardown is not read).

## Lifecycle

- Ownership changes only through map scripts (`ChangeVehiclesPlayerId`); there is no capture.
- A defeated player's vehicles are destroyed, not transferred (animals go to player 20).
- There is no dismantle, sell or store command. Player commands: go to, unload people, dock, attack
  inhabitants / building / vehicle / position, attack / defence / hold stance, attach vehicle,
  detach vehicle, unload goods.
- Vehicle tasks shown in the window: 0 none, 1 docks, 2 attacks, 3 waits for human, 4 waits for
  animal, 5 interrupted, 6 boards ship.
- Draught animal: an ox cart without ox (type 6) sets task 4 and recruits the animal itself from the
  owner's animals of tribe 10 on the door's continent, skipping the first two eligible animals
  (a breeding pair) and taking the nearest; the animal walks over, is consumed, and the cart becomes
  type 2 in place. Missing animal on a goto raises `vehicleNoAnimal`.

## Map scripts

`[StaticObjects]` rows (see [MISSIONS.md](MISSIONS.md) for the loader):

- `setvehicle <player> "<tribe>" "<type>" <x> <y> <missionId>`: seven columns; an eighth `0` on
  15 corpus rows is never read. The row runs only for an occupied seat (no `player >= 20` bypass),
  and a dropped row also drops its trailing modifiers. 623 rows in 56 of 123 maps: catapult 386,
  ship small 130, ox cart 58, handcart 41, ship big 8; 52 rows carry a mission id and 53 an
  `addgoods` run. The type is a `name`, and both ox carts are named `oxcart`: which of types 2 and 6
  the original picks is *open*; the decoded entity keeps the name and the app's join takes the first
  record (type 6).
- `addgoods "<good>" <n>` after `setvehicle`: adds to reserved and current, never to wanted.
- `attachtovehicle <x> <y>` after `sethuman`: attaches the human to the first vehicle on that node
  through the normal attach gate (the first one becomes commander); it does not move him. 13 corpus
  rows on 4 maps, every one on a `setvehicle` node of its map; decoded as the human's
  `boardVehicleAt`.
- `moveintovehicle`: the human boards the vehicle he was attached to (removed from the map). 10
  corpus rows, all after an `attachtovehicle`; decoded as `boardVehicleAt.inside`.

Results: `SendVehicle` and `DockVehicle` snap the point to the nearest unblocked node with the same
continent key within radius 9, then queue `e` / `g` like a player click (Open Northland runs the seat
handlers directly: the goto's own radius-9 snap, and for a dock the ring search with no prior snap). `AddGoodsToVehicle` adds
the full amount to every matching vehicle and raises wanted by the same amount.
`AttachHumanToVehicle` resolves the first vehicle with the id and queues the attach command for
every matching human. `RemoveVehiclesWithMissionId` handles at most 50 vehicles, removes crews only
when its flag is set, and stamps a wreck effect. `RemoveVehicles` frees silently. `MoveUnitsInArea`,
`ChangePlayerPlayerId` and `ChangePlayerIdInArea` include vehicles.

## Graphics

`DataCnmd/types/vehiclestype/jobgraphics.ini`: carts and the catapult draw from
`CR_Veh_Body_00.bmd` (palettes `goods01`, `oxcart`, `goods_bow`), ships from `LS_vehicles.bmd`
palette `human_Ship01` with player colour from the ship palette table (`palettes.ini`
`human_Ship01`..`human_Ship10`; player index to member is *inferred* from the numbering). Bob
sequences: `vehicles_bullcart_wait` 0+48, `_walk` 48+96, `_empty_wait` 144+1,
`vehicles_catapult_attack` 145+96, `vehicles_catapult_drive` 241+64, `vehicles_handcart_wait`
305+1. Atomic actions: 2 idle, 4 the ships' second hull, 81 attack, 84 dock (no graphics record),
8 facings. Ship rows use raw frame indices without `gfxbobseqbody`, which is why the IR has no
`gfxAtomics` rows for jobs 52 and 53.

The IR's `vehicleGraphics` lane joins the body binding of each `(tribe, vehicleType)` with the
vehicle job's records, resolved to bob ids of that body: `clips` per action and `gaits` per hauled
good (ships author `wood` as the loaded hull and carry `turnFrames`). Holes in the shipped data,
which the renderer needs fallbacks for: Egypt (tribe 7) has no vehicle binding at all; only Viking
and Frank have a big-ship binding, and the Viking one is the 32-frame `ve_test_ship.bmd` whose rows
still index the 98-frame `LS_vehicles` layout, so its loaded hull (bobs 66..94) has no frame,
while the Frank one has hulls but no gait; the ox-less cart has records for Viking and Frank only; the handcart's drive reuses
`vehicles_bullcart_walk`; Byzantine carts and the Saracen ox cart have a wait but no drive.

Open Northland draws a vehicle as one `vehicle` draw item bound per `(tribe, vehicleType)` from the
lane (`packages/app/src/content/vehicle-gfx`, `packages/render/src/data/sprites/vehicle.ts`), with
these choices for the holes:

- A tribe with no rows (Egypt) draws the world's base tribe's looks (`fallbackTribe`, the viking),
  and so does a row that binds nothing (the Byzantine and Saracen ox-less cart).
- A clip naming a bob the baked body lacks is dropped at load, so the Viking big ship sails on its
  empty hull (`ve_test_ship` holds bobs 0..31); a cart with a wait but no drive stands its wait while
  it moves. Every state falls back down `loaded → unloaded → wait`.
- The catapult loops its 40-frame shot over the 48-tick attack cadence while `task` is `attacks` and
  stages `fx smoke` (weapon 21's `createsmoke`) for the last 20 ticks of each cycle; which smoke record
  and where in the clip the shot releases are approximations.
- Ship player colour: the pipeline bakes only `ls_vehicles.human_ship01`, so every player sails the
  player-one hull today and the binding carries no per-owner atlas. The cheap route when team colour is
  wanted is the characters' path, one indexed `ls_vehicles.indexed` atlas plus a ten-row ship LUT
  (`human_ship01..10`) read through `PalettedSprite` (the hull bobs are the same type 1/4 as the
  character bobs), about 1.5 MB in all, not ten 1.5 MB bakes.
- The ships' `gfxturnframelist` in-place turns are not played; a facing change snaps.
- A wreck's `ruins` nodes draw the `debris wood` `[GfxLandscape]` records for the bone pile's lifetime
  (approximation: the ruin landscape type is unidentified, see above).
- The trader's `human_man_z00Trader_walk` gait plays only while a vehicle's `passengers` seat it; a
  lone trader walks the carrier's gait. The seat lists are the only rider-side signal today.
