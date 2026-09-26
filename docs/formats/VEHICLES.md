# Vehicles

Handcarts, ox carts, ships and catapults are one entity class in the original. This reference
holds the original's vehicle behavior and the mod's readable `.ini` files. A rule that cites an `.ini`
key or a corpus count is read from that data; every other unmarked rule is a reading of the original's
behavior, unconfirmed against the running game. *Inferred* and *open* mark weaker claims.
Corpus counts are over the decoded `content/maps` of `CNMod-1.3.2` (123 maps). Open Northland
approximations are named where they are made. The IR carries the type table as `vehicles` (`VehicleType`, with `jobId`, the
slug `cart_no_ox` for type 6, `passengerJobs`, `commanderJob`, `vehicleSlots`, `passengerVector`,
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
| `logicpassenger n` | Allowed job ids for attaching. The same list, indexed by a vehicle *job* id (50, 51, 54), says which vehicles a ship may carry. Catapult: 31..47 (soldiers and heroes). Ships: 5..47 plus 50, 51, 54 (the big ship lists no vehicle). Carts 1 and 2: 24, 25. The ox-less cart (6) lists none, so nobody can attach to it until its ox arrives and it becomes type 2 ("Lifecycle"). |
| `logiccommander n` | The trade the `SetVehicle` result spawns as captain ; nothing else reads it. Carts 1 and 2: 25 (trader); ships: 24 (carrier); catapult: 31 (soldier); the ox-less cart (6) authors none. The commander seat itself goes to the first attached human with an allowed job. IR: `VehicleType.commanderJob`. |
| `passengervector a b` | Door geometry: direction offset `a` from the facing, distance `b`. `b` is also the ring radius searched around a dock click (ships: 2 4). |
| `stockvector` | Parsed, no logic reader found (*open*; probably a render-side cargo point). |
| `vehicleslots` | Carried-vehicle slots: small ship 1, big ship 0. |
| `logicdragginganimaltribe` | Animal tribe the cart recruits (ox cart without ox: tribe 10). |
| `logictransformvehicleType` | Type the vehicle becomes when the animal arrives (6 -> 2). |

Hit points (table indexed by type): ship small 5000, ship big 5000, catapult 3000, everything
else 1000; the pipeline stamps the table onto `VehicleType.hitpoints`. Vision: 15 default, ship
small 20, ship big 25, catapult 20 (Open Northland still gives every vehicle the
civilian radius, *open*). Vehicles have no armour.

## Construction

A workshop never stocks a vehicle good (59 handcart .. 63 catapult; `goodtypes.ini` marks them
`isProducedOnMapFlag 1`, `atomicForProduction 39`, though `prey` (56) shares that flag shape, so the
flag alone does not single them out). Each vehicle good pairs with a house type 42..46
(`logicmaintype 6`, `logicvehicletype n`, `logicworker 24 3`; the two ship houses also carry
`logicignorecontinentsflag 1`). The pairing in the IR follows the shared `VEHICLE_*` suffix of the
`GOOD_TYPE_` and `HOUSE_TYPE_` defines in `logicdefines.inc` (*inferred*: the original's own join is
not confirmed; the shipped ids pair 59..63 with 42..46 in order). House 43 (`oxcart`) spawns
type 6, the ox-less cart. The worker producing that good:

1. reuses an unfinished vehicle site within hex rings `r < 20` of the work centre, otherwise picks a
   build point within `r < 10` (5 and 10 for jobs 18 and 29) where every footprint node has
   free-size class `>= logicsize`, house placement is allowed, and no parked vehicle stands inside;
   with `logicignorecontinentsflag` the point's continent must differ from the worker's and the
   house work point must lie on the worker's continent, which is how a ship site lands on the water
   beside the shipyard (Open Northland reads the class at the anchor alone for a ship site, since
   the hull's shoreward rows lie against the land its door stands on; approximation, the original's
   per-node test is read for land sites only);
2. fetches and carries the house's construction goods like building materials (the IR's
   `construction` list of houses 42..46: handcart 2 wood, ox cart 5 wood, small ship 5 leather +
   10 wood, big ship 5 leather + 15 wood, catapult 9 wood + 1 iron), taking them from its own
   workshop's stock first, recipe inputs included, and otherwise from the nearest loose pile or
   house within radius 40 that is not a home, where another workshop's inputs stay hidden;
3. works on the site with the ordinary build animation;
4. when the site reaches the finished state the house is freed and a vehicle of `logicvehicletype`
   spawns at the house position for the same player and tribe, with mission id 0.

Failure reasons 8 (no spot) and 9 (a parked vehicle blocks every ring point) raise the
`vehicleSiteNotFound` / `vehicleSiteOccupied` messages. Chest kind `[` spawns a catapult for the
opener. Map scripts and `SetVehicle` are the other spawn sources.

Open Northland (`systems/settlers/drives/economy/vehicle-yard.ts`, `systems/footprint/placement/vehicle-site.ts`):
the operator's craft rotation treats a vehicle good as a turn taken outside on the yard site, never as a
cycle, and moves past it once the site launched; the site is a `SiteAssignment` crew membership like a
builder's, the yard's bill is fetched from the worker's own workshop first, its recipe inputs included,
then through the ordinary site-supply rungs, and builders and haulers
never serve a vehicle site. Approximations: which product a worker "currently" makes is the rotation
cursor (the original's scheduling is not decoded); the work point is the house door for both hammering
and the ship site's shore test, so "a water continent bordering the worker's continent" reduces to the
door lying on the worker's land component; a ship site needs the water side of the shared free-size field to admit
`logicsize` at every body node, all on one water body; a parked vehicle counts as reason 9 only when it stands on the house body, since a
vehicle is also a placement obstacle for the reserved margin; a failed search skips the turn, so the rotation moves on to the
workshop's other products, and the worker searches again only after the failed-goal memo's span; past its own workshop the fetch takes the nearest store
the settler may reach, with no radius-40 cap; the finished site leaves without a collapse event and
heaps any surplus delivered past the bill. The chest catapult takes the opener's tribe.

## Crew

- Attach: same player, job in
  `logicpassenger`, and either no commander yet or a free ordinary slot. No distance check. The
  human leaves his work house, drops attack targets and walks to the vehicle. Attaching to another
  vehicle detaches first.
- The first attached human fills the commander slot; detaching the commander promotes the first
  remaining allowed-job passenger. No commander means the vehicle cannot move, dock or fire.
- Detach: refused for a ship not moored; a vehicle riding a carrier is sent out first; the
  human is put on the door cell. Several ordinary human commands force a detach first.
- Door (the entry point for a clearance `size`): a moored ship's mooring point; otherwise the map
  position moved `passengervector[1]` steps in direction `passengervector[0] + facing` (modulo six), so a cart or
  catapult, which authors no vector, has its entry point on its own node. When that node is blocked or
  its size class is below `size`, the scan moves the cursor one step north-west and then, for each
  of the six directions in turn, steps first and tests second, so the ring of radius 1 is tested
  north-east, east, south-east, south-west, west, north-west; the first node on the map that is not
  blocked, has the same continent byte and a size class `>= size` is the entry point, and a failed
  scan leaves the cursor on the north-west node. The carrier asks with `size` 0. A parked vehicle
  sets no blocked bit: it is only linked into the node's list of movers, so humans walk through a
  standing cart and its crew and cargo hands stand on the cart's node.
- Board ("moves inside"): succeeds only when the human stands on the door point. Aboard, the
  human is removed from the map. Leaving happens on the door cell, which for a moored ship is its
  mooring point on the shore. The step itself seats the human, detaches him from the map, resets his
  targets and marks him aboard; the loader and the `SetVehicle` captain take it with no door check.
- Boarding drive: for every slot the vehicle orders a passenger on the door's continent inside and
  detaches one on another continent (stragglers are dropped, not awaited). A passenger with a
  pending need blocks boarding. Task 3 "waits for human" while anyone is outside.
- Carried vehicles: a small ship takes one cart or catapult (load into carrier, move inside and
  leave orders). The carrier is a moored ship with a slot for
  it, the vehicle stands on the continent of the carrier's door, and the vehicle's crew count fits
  the carrier's free passenger room; the crew stays seated in the carried vehicle. The vehicle's
  task 6 boards its own crew first, drives to the carrier's door and enters there; a failed gate
  raises message 0x36 and a missing entry point 0x38, each followed by a detach.
- Messages: the human's attach refusal and detach refusal raise their own ids; the human's
  move-inside task raises 0x2b when its vehicle is a ship that is not moored; a carried vehicle
  that fails to detach raises 0x39. A human detaching from a ship at sea is refused silently.

Open Northland: `Rider` (`packages/sim/src/components/vehicle.ts`) marks an attached settler and the
seat's `inside` says whether it is aboard; a rider aboard has no `Position`, which is what keeps it
out of every map query. Inside a cart its needs and hitpoints stand still (approximation: the
original's hitpoint step aboard is not read); inside a ship they run on, and `shipboardNeedsSystem`
(`systems/vehicles/shipboard-needs.ts`) serves them aboard: a hungry passenger eats a unit of food out
of the hold, a tired one sleeps, a lonely one chats with a fellow passenger, each worth what the clip
it would play on land pays in, rest at the open-air half, at most once per clip length. Piety waits for
land (owner's choice; whether the original serves a rider aboard is unconfirmed). `attachToVehicle` walks the rider to the door through the
unconfined walk order and ends any chat it was in; the rider rung of the drive ladder
(`systems/vehicles/boarding.ts`) steps a passenger in as soon as it reaches the door, while a carrier
or trader, the crew that works its vehicle from outside, waits by the door until the vehicle asks
(deviation, owner's choice: the original keeps every rider outside until asked). A rider on a neighbour of a
door another settler holds boards from there (approximation: the original's humans stand through each
other, a collider here cannot). A goto with anyone outside holds its goal under `waitsForHuman` and
starts once the crew is inside, as the original boards its crew ahead of a target;
the request is a forced boarding that outranks the rider's needs, which wait for the ride (deviation,
owner's choice: the original skips a rider with a pending need). `loadIntoVehicle` is the load and move-inside orders in one. An attack order given while the crew is still outside
waits under `waitsForHuman` like a goto's goal and the combat pass takes it up once everyone is in
(approximation: the original boards its crew ahead of any target, which is confirmed for the goto
only). Named approximations: the job and
owner refusals of attach raise `cannotEnterVehicle` and a full vehicle `vehicleNoPassengerRoom`; a
refused load raises `cannotAttachVehicle`, which the original never raises; a rider refused off a
ship at sea raises `cannotLeaveVehicle`; a standing vehicle's whole disc is blocked for humans, so a
settler walks around a parked cart and an entry point inside the disc always takes the original's
ring fallback, the first open ground node on the anchor's continent around the ring just outside the
disc, tested in the original's order, with the entry point kept when the ring has none
(`vehicleDoorPoint`; the original blocks nothing and walks the crew onto the cart, and its scan is the
radius-1 ring only, where a catapult's door here lies on ring 2); a rider boards from and steps out
onto that door node or, where another blocker covers it, the nearest open node beside it; a rider
whose walk to the door fails is dropped with a
lost note; the ordinary orders that detach first are the walk, attack, work, trade, home, school,
drill, marriage, need, equipment, explore, signpost and chest orders; a commander detaching mid-drive
leaves the drive running. Deviation (owner's choice): a walk or attack-position order given to a
vehicle's commander, aboard or standing beside it, is handed to the vehicle as its goto
(`systems/vehicles/commander.ts`), so a trader ordered somewhere takes the cart and its cargo along;
the vehicle's refusals apply and a refused point leaves the commander seated. The original detaches
the commander and walks him off alone, leaving the cart standing. A commander outside drops its own
walk to board at once, while one held by an atomic finishes it first (a trader completes the unit it
is loading). Detach and unload people remain the way to leave a vehicle behind.

## Cargo

Wanted amounts are the per-vehicle request list. The hold keeps three bytes per allowed good:
the actual amount, the wanted amount, and the future amount, which is the actual amount plus the
units carriers have booked to bring (a booked unit's arrival raises the actual amount and leaves the
future one). Changing the actual amount clamps to capacity, refuses negative stock and, when no
carrier is attached (any seat, the commander's included, held by a job-24 human), sets wanted to the
new actual amount. Setting a wanted amount clamps so the wanted amounts over every good fit
`stockslots`. The hold is full when the actual sum reaches the budget, and full soon when the future
sum does.

The carrier is a job-24 human attached to the vehicle and standing outside on the door's continent;
a ship serves only while moored. Its loop:

1. While the hold is not full and any good has `wanted > future`, it collects every such good and
   searches loose goods and houses within radius 40 of the door, ignoring homes, picking at random
   among the piles found, else among the houses, else asking the guide network (radius 40) for the
   first good it links; nothing found parks the carrier. It fetches one unit. With the
   unit on its back it books it (`future + 1`) and walks to the door while
   `future < wanted` and the hold is not full soon; at the door `future <= wanted` and not full
   puts the unit in, else it is brought away.
2. Else, for the first good with `wanted < future`, it unbooks a unit (`future - 1`), walks to the
   door and lifts one out, then carries it to a consumer near its work centre, else a pile point near itself,
   else one near the door.

The vehicle window's wanted order edits one good's wanted amount (by 1, 10 with Shift) and the clear
order clears every one; both wake idle passengers and raise message 0x3a (`vehicleNoCarrier`) when no
carrier is attached, the order applying all the same. Unload people moves every passenger and
carried vehicle out; it has no goods half, the goods leave through the clear order. The
`AddGoodsToVehicle` result books, stows and then sets wanted to the wanted amount read after the stow plus
the amount, so a vehicle with no carrier ends with `wanted = actual + amount`. Message 0x0f
(`noVehicleForWork`) is the trader's: it idles on it when the human is not the commander of an
attached vehicle (message 0x10, `noTradeAgreement`, is its idle for an agreement that stopped
holding). The trader loads its cart itself: it books a unit as it sets out for the door and stows it
there, the reverse for a unit it takes out, so with no carrier attached wanted follows actual; the
cart's move near a house is described in MISSIONS.md "Trade agreements".

Open Northland: `VehicleStock` (`packages/sim/src/components/vehicle.ts`) keeps the three bytes per
canonical good as `current`, `wanted` and `reserved` (the future amount); `systems/vehicles/stock.ts`
holds the clamps, `stockVehicleGoods` the booked-and-stowed write of `addgoods` and a loaded spawn
(wanted follows actual while no cargo hand is seated, as the original's stow does without a carrier),
and `addGoodsToVehicle` the script result. The seat orders are `setVehicleWanted` and
`clearVehicleWanted`; `unloadPeople` is the passenger half of unload people (the carried-vehicle half
is not mirrored, *open*). The cargo rung (`systems/settlers/drives/economy/vehicle-cargo.ts`) runs
above the rider rung for a cargo hand and its booking rides on the hand as `CargoRun`, given back when
it detaches or dies. Owner's choice: a cargo hand is a seated carrier or the vehicle's commander of any
trade, so a trader's cart and a ship's commander serve the wanted amounts without a carrier; the
wanted-follows-actual rule and message 0x3a read the same widened test (`isCargoHand`). A hand riding
inside a cart that stands still or a moored ship steps out onto the door while the hold has a trip for
it (`cargoHandDisembarkSystem`). A commander of another trade than the carrier's, with no carrier
seated, lowers a request no source can fill to what is booked instead of waiting by the door. No hand
takes food out of a home, the trader's rule (owner's choice). The alias goes through the shared
dish-to-edible seam, which also maps meat and sausage (approximation: the original's table lists
neither). Further approximations: the nearest source wins where the original draws at random, ties by
good id, every source on the door's continent as the original's flood implies; the guide network is
the carrier's signpost confinement; a lifted-out unit goes into the nearest own warehouse or
headquarters with room within radius 40 of the door, never onto a workplace's shelf, and onto the
ground where the hand stands otherwise (owner's choice); a house source must hold the hold's canonical good, never a dish it
would alias to it; a cargo hand whose walk to a source or store fails takes the planner's stranded
recovery and keeps its seat, where only a failed walk to the door drops it. The trader's own write is
`tradeVehicleStock`: booked and stowed in one step, and the wanted amount set to the actual one
whatever crew is seated (approximation: the original's rule holds only without a carrier; here the
trader is its cart's own cargo hand, and it finds nothing of its trade cargo to fetch or flush).

## Movement

One navigation graph. A node is passable for a vehicle when its blocked bit is clear and its
free-size class (3 bits per node; how the original computes it is *open*) is `>= logicsize`.
A goto needs a commander and silently ignores a target whose continent
id differs from the vehicle's or whose size class is below `logicsize`, which keeps ships on their
sea and carts on their landmass (continent type 1 is land). The walk searches with a range of 60,
the vehicle twin of the humans' 50/63 walk range; a failed search raises message 0x32 and re-aims
the vehicle at its current node. Humans inside the footprint are shoved away on every node reached.
Per node the move period is `max(3, (g*2 + 4) << catapult)` ticks with `g` the 4-bit ground speed
class stored beside the size class in the node record, which is the map's `lmpr` roughness, re-read at
every node reached; each tick adds `(period + 9999) / period`
to a per-node counter that completes at 10000, and the map position moves at 5000. The catapult is
the only vehicle with the doubling; a turn costs 2 ticks per hexagon direction. Stop (task 5
"interrupted") and returns to the current node.

Open Northland: one `TerrainGraph` carries both mover classes (`Traversal`, `nav/terrain`): a
settler, cart or catapult walks the land nodes, a ship sails the water nodes (unwalkable ground no
land vertex claims), and the static component labels land and water bodies in one key space, land
first, so the goto's continent test and the dock ring search compare the same key on either side.
The free-size class is the largest hex-disc radius of open same-continent nodes around the node,
capped at 7, one field for land and water (`nav/clearance.ts`); `g` is the roughness of the node a leg
leaves (`TerrainGraph.roughnessAt`; a map without the lane reads 2 on land and 1 on water, the corpus's
common values); the walk range is a hexagon
distance gate on the goto; an off-continent or out-of-range target raises `vehicleNoPath` instead of
being ignored; a goto held for a crew still outside is refused at once when no route exists at order
time, where the original's pathfinder runs after the boarding; the anchor and footprint move at the
start of a leg, not halfway; a lattice edge of two map points takes two periods; the vehicle faces
the hexagon direction its lattice step is made of at once and holds on the node it leaves for the
turn's 2 ticks per direction, drawn there while its progress stays below zero; parked vehicles' cells are
routed around by vehicles and humans alike (the original's humans walk through them, see "Crew"), the
shove happens on entering a node only and sends a settler outside the discs of the whole remaining
route. Open Northland shoves only owned settlers standing still (the planner's kept occupancy): one
already walking passes on, and an unowned animal's next wander leg steps it off the disc
(approximation). A real map's water is the cells whose two ground triangles are both
`isWater` pattern types (approximation of the per-node rule; an unknown or border pattern counts as
land, so a ship never sails onto the map edge).

## Ships and docking

Ships never attack. A ship spawns moored when a land continent borders it within
`passengervector[1]` steps, otherwise with no mooring point. Dock on a land point needs a commander;
a moored ship boards its crew first and the order waits while anyone is outside; then it scans the hex ring of exactly radius
`passengervector[1]` around the point, starting `passengervector[1]` steps north-west and turning
through the six directions, for a non-border node whose continent byte equals the ship's own and
whose size class is `>= logicsize`, and starts the walk (range 60) to the
first that takes it; the walk sets task 1 "docks" and stores the *clicked point* as the mooring
point. A ring node that is the ship's own position ends the order with nothing set. When no ring
node takes the walk, a ship with its commander inside raises 0x32; without one it stores the point
and plays the dock clip in place. Every node reached clears the moored flag, and so does every walk
start; on the last node of a dock walk the dock clip (atomic 84) plays, and when it ends the task
clears and the moored flag is set. A goto arrival with no commander inside re-moors the ship when a
land continent borders the ring; with the commander inside it stays at sea. No message is raised on
arrival. No port building is involved. Unload people on a ship empties the crew onto the door cell only when it is on
land. When a vehicle leaves the map with its door on land, riders who are aboard are put on the door
cell and riders still walking to it are only detached where they stand, and a carried vehicle is set
down on the door cell; with the door at sea the
crew dies and a carried vehicle is removed with the ship. Ships leave no wreck and no cargo.

Open Northland: a spawned ship's mooring point is the nearest walkable node in hexagon-ring order
within the door distance; the door direction adds the vector's offset to the vehicle's facing in the
six map-point directions (approximation: the vehicle facing space is not read). Which node the
original stores as the spawn mooring is *open*. `dockVehicle` (`systems/vehicles/dock.ts`) holds the
point under the `docks` task while the crew boards, the twin of the goto's `waitsForHuman` hold; a
ring node is open when the ship's walk-block admits it, which adds other vehicles' cells to the size
class test, and lies within the ship's walk range; a ship already on a ring node moors in place and
drops any drive under way (approximation: the original ends the order with nothing set); no ring node raises `vehicleNoPath` whether or not the commander is inside; the
ship moors on the arrival tick with a `vehicleDocked` event (approximation: the tribe binds atomic 84
to a 12-tick dock clip, which is not played); a goto clears the pending mooring point and never re-moors on
arrival (the commander-less re-mooring is not implemented, a goto needs a commander anyway); a dock
walk that loses its route drops the mooring point behind the `vehicleNoPath` note. A sunk ship's
crew is reaped like any death, so the owner's casualty tallies count it. The dock pick shows where the
order would moor (`mooringProbe`): the water the ship can reach under its walk-block within the walk
range is flooded once per blocker change and ship position, and every walkable node at exactly the door
distance from it is a mooring spot, lit on the map; the rest is dimmed, a click there orders nothing, and
a ship's right-click on a lit spot docks instead of the refused goto. Approximations: the original's
dock command takes any point, the probe accepts land only (where the crew can step off); the flood is
bounded to the walk-range disc, so a route that leaves the disc and returns is not found.

## Catapult

Crew: one soldier or hero (jobs 31..47); the crewman gains experience for weapon 21. Weapon 21
(`weapons.ini`, equal for all tribes): range 8..24, munition type 2, speed 3, `hitself 1`,
`createsmoke 1` lifetime 20, damage `0:8000 1:4000 2:6000 3:2000 4:2000 6:350 7:3625`, hit
sound 90. No ammunition and no reload counter; cadence is the attack clip job 54 binds to atomic 81
(`viking_catapult_attack`: `length 48`, the shot at its `event 1 25`), read from content.

The original's goto never scans while the vehicle drives. Open Northland adds an attack-move
(`moveVehicle` with `attackMove`: the attack-move key with a catapult selected, or its commander's own
attack-move). The march fights in the attack stance whatever the vehicle's stance, a find ends the
drive on the node it crosses, and once nothing is left to fight the vehicle drives on to the goal.
After a find no firing node reaches, the march drives on for 5 seconds without scanning
(approximation). A goto, stop, ordered attack, loading into a ship, unloading the crew, losing the
commander or a script teleport ends the march; with no route left it ends where it stands with the
goto's no-path note, and that spot becomes the guard position.

Stances (init 3): 3 hold = scan 8..24 around the guard position, never reposition; 2 defence =
scan 0..40 around the guard position, abandon the chase beyond 60; 1 attack = scan 0..40 around
the current position. The command-to-stance mapping is *inferred*. Targeting prefers enemy units in
buildings, then enemy houses, keeping the nearer of the new and current target; too close backs off
to a node inside the band, in range fires, too far drives to a node between `maxRange - 5` and
`maxRange` of the target on the same continent, else floods a radius-5 disc for a firing spot.

Firing (atomic event 25 at clip tick 1, commander aboard): the
scatter roll `r = rand % 100` against `accuracy = commanderSkill + 10`, where the skill is the
commander's raw weapon-21 (main type 7) experience counter, capped at 10000. When `r > accuracy`
the impact moves by `spread = (r - accuracy) * (dist / 4) / r`: two more draws give `dx = rand %
(spread + 1) - spread / 2` and `dy` alike (integer arithmetic, so the offset is biased toward the
positive side). Flight ticks `dist * 8 / speed` to the scattered point; the impact reveals radius 2
for the owner. The delayed hit reads ONE node, the
landing point: every human and animal standing on it, the vehicle or house whose body covers it,
and the landscape there, the owner's own included (`hitself`). Humans, animals, houses and vehicles
take their column; a landscape with a player id (the walls, `playeridallowed 1`) takes
`damage[7] / 100` steps of its trigger-10 transition (`transition 10 82 2 -1 0`: one valency each)
and clears when the valency drops below one, so a 100-valency wall falls to three stones (36 steps
each) or twenty hero-sword blows (any weapon whose column reaches 100, a short sword's 225 being two
steps). Landscape logic type 4 is the tree, which weapon 21 alone fells (valency
`> 2` runs transition 11, else the node clears; Open Northland does not fell trees, *open*).

Damage to any vehicle: `damage[6] * 200 / (200 - min(armour, 100))`, armour 0, halved for
player 0 on easy. A human striker raises the owner's "vehicle attacked" note (0x34); a vehicle
striker does not. At 0 hit points the vehicle is removed; carts and catapults scatter ruin
landscape on 51 % of footprint nodes and drop all cargo within radius 10.

A scripted removal draws no ruins, spills nothing and draws no random number; a player leaving the
game removes his vehicles with ruins but without the cargo spill.

Open Northland (`packages/sim/src/systems/conflict/engage-vehicle.ts`, `ground-impact.ts`): the
stance, guard position and attack ride on the `Vehicle` component; the guard position is set by
the stance order and a goto's end (approximation: which order writes the original's is not read).
Ranges are Manhattan half-cell nodes like every other weapon band (approximation: the original
measures hexagon distance). The four-step target preference is one nearest search (approximation).
The stone is a `Projectile` with a ground-burst payload that covers its release chord in equal steps
over `dist * 8 / speed` ticks and lands a tick after it reaches the aim, so the drawn stone finishes its
last segment (approximation: the original lands on the last flight tick); the burst treats a house as covering its walls, its
reserved ring and its anchor (approximation: the original's in-house test area is not read), and it
strikes a garrison standing on its tower's node (*open*: whether the original's hidden-human skip
covers a posted archer is not read). A wall stands as a palisade entity, so the burst strikes the
segment whose body covers the node and takes `damage[7] / 100` off its hitpoints through the walls'
own rule, the one every other weapon's blow goes through. The commander's experience scales the
stone as it scales a swing: the house formula against a building, the fight bonus against anyone
else, nothing against a wall (approximation: the original's delayed hit is not read for it). A
settler resting indoors is passed over, as every other shot passes over it, and an ordered stone may
name a wall. A fleeing settler runs from an armed vehicle and never from a cart or ship
(approximation). The note is raised for any striker (approximation). An auto target no firing node reaches is
given up for the combat memo's 30 seconds (approximation: the original drops it and scans again on
its next update). `hitself` is not extracted; the burst hits every
side, which the data's `hitself 1` also says. A victim whose player is not at war with the shooter's
either way is wounded without the blow changing the stance or recording an attack (approximation: the
original's reaction to friendly splash is unconfirmed). `removeVehicle` (`systems/vehicles/remove.ts`) draws
the ruin nodes through the seeded RNG and carries them on the `vehicleDestroyed` event for the
renderer's decals, since the ruin landscape type is not identified (*open*); the cargo spill walks
the shared Manhattan spill rings (approximation). The match rule's defeat teardown reuses the
leave-game path, ruins without cargo (approximation: the original's dead-player teardown is not
read).

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

Open Northland (`systems/vehicles/draught.ts`): a vehicle whose type names a `draggingAnimalTribe`
spawns under `waitsForAnimal` and refuses a goto with `vehicleNoAnimal` ahead of the commander gate,
as the original tests the missing animal first. The recruit scan runs every `DRAUGHT_RECRUIT_CADENCE_TICKS` (20) for
such carts only and walks the livestock store: the owner's animals of the tribe with a position, not
inside a farm, led away by no breeder nor booked by another cart, not scattering, on the door's continent, in
ascending entity id; the first two are passed over and the nearest of the rest by hexagon distance
wins, ties to the lower id. The recruit carries `DraughtAnimal` (which the herd, graze, herd-home and
breeder's slaughter pick respect like a breeder's summon, and which a scout's capture drops with the walk) and is aimed at the cart's boarding node, the riders' door beside the cart,
re-aimed whenever it stops short; on arrival `harnessVehicle` removes it without a death and the cart
takes `transformVehicleType` in place, with that type's seat counts and hit-point pool (current points
kept, clamped), so the renderer's per-type binding swaps the sprite. A recruit whose cart is gone walks
back to its stay point. Approximations: the scan cadence, the id order the pair is skipped in, the
livestock-store scan (a draught tribe that is not catchable is never owned and never found), the
boarding node standing in for the cart's own node, and the pool handling on transform; the
original's animal list order and transform details are not read.

Open Northland (`packages/app/src/hud/details-panel/model/vehicle.ts`, `view/unit-controls/vehicle-orders.ts`):
a vehicle is selected by a click on its drawn sprite (solid pixels), after the door markers, flags,
settlers and buildings under the same point and before a signpost. A marquee takes every own
vehicle whose drawn bounds it touches along with the settlers (an addition); the window opens for
one vehicle alone, and a group, or vehicles boxed with settlers, shows only the selection count. The
world tooltip reads "type · player · task". The window stacks Ogólne (owner, task, stance or
carrier, capacity, hit points), the order buttons, Mieszkańcy (commander first, then passengers and
carried vehicles, each row selecting what it names, a rider still outside marked) and Magazyn (the
store window's category tabs over "aboard/wanted" cells with the wanted steps of 1 and 10 with Shift,
"Wszystkie" listing the lines with anything on them). Labels are the `vehiclewindow` and
`misclogic` strings where the original has one. Approximations: the section stack, the button grid
and the tabbed hold are authored, not the original's window; the order set per type (every vehicle
drives and stops; a ship moors and lands its crew; a siege engine takes the attack orders and the
three stances; a hold-less vehicle has no unload-goods; the carrier pair follows whether the
vehicle rides a ship) and the stance buttons' "hold" name come from the command semantics, not a
button-by-button reading; the clear order is the "unload goods" button; the right-click defaults follow the
original's order (enemy human, own moored ship for a land vehicle, enemy vehicle or house, else go
to) but the attack defaults apply to an armed vehicle only, since the sim drops an unarmed one's
attack order silently; a ship's right-click on a shore the mooring probe accepts docks there, elsewhere
it is a goto the sim refuses, the mooring order being explicit; a group's right-click (an addition)
sends its armed vehicles at the enemy under the cursor and drives the rest to spaced slots there,
never boarding or docking; the ring's "Assign Vehicle" is offered
to every grown settler, its pick lights the settler's own vehicles green where `canAttachToVehicle`
(job list, free seat, a door on the settler's continent) takes it and red otherwise, and a red vehicle
drops the click; the selected settlers' right-click on an own vehicle attaches each one that rule
admits (approximation, owner's choice: the original assigns through the pick only); a commander selected while aboard (through the Mieszkańcy row) stands for its
vehicle, so a right-click on the ground drives the vehicle whether the commander is aboard or beside
it, and the ring's "Remove Vehicle" (`misclogic` 32) is the detach order for any rider. Message ids
0x0f (no raise site, *open*) and 0x16 (no vehicle discovery event) have no raiser yet; 0x35 is the
goto refusal above.

## Map scripts

`[StaticObjects]` rows (see [MISSIONS.md](MISSIONS.md) for the loader):

- `setvehicle <player> "<tribe>" "<type>" <x> <y> <missionId>`: seven columns; an eighth `0` on
  15 corpus rows is never read. The row runs only for an occupied seat (the same gate as `sethuman`
  and `sethouse`, with no `player >= 20` bypass), and a dropped row also drops
  its trailing modifiers. 633 rows in 57 of 123 maps: catapult 386, ship small 140, ox cart 58,
  handcart 41, ship big 8; 62 rows carry a mission id and 53 an `addgoods` run. The type is a
  `name` resolved against the seven `[vehicletype]` records in type-id order, so `oxcart` is the ox
  cart (2), never the ox-less cart (6); a name nothing matches is type 0 and places nothing.
- `addgoods "<good>" <n>` after `setvehicle`: books `n` units, then stows them, and the stow sets
  the good's wanted amount to the new actual one while no carrier is attached, which at load is
  always: the cargo is booked, stowed and asked for, so a carrier seated by a later row neither
  fetches nor flushes it.
- `attachtovehicle <x> <y>` after `sethuman`: attaches the human to the first vehicle on that node,
  through the normal attach gate (the first one becomes commander); it does not move him. 23 corpus
  rows on 5 maps, every one on a `setvehicle` node of its map; decoded as the human's
  `boardVehicleAt`.
- `moveintovehicle`: the human boards the vehicle he was attached to wherever he
  stands (removed from the map). 20 corpus rows, all after an `attachtovehicle`; decoded as
  `boardVehicleAt.inside`.

Open Northland (`packages/app/src/game/world/authored-placements.ts`, `systems/spawn/attach.ts`):
a `setvehicle` row becomes a `createVehicle` before any human, its cargo through `stockVehicleGoods`
(booked, stowed and wanted, as above); the name join takes the lowest type id sharing the name. A
crewman's `boardVehicleAt` rides on its `spawnSettler` as `vehicle` and goes through `attachToVehicle`
at the spawn, which also walks him to the door, where a passenger steps in and a carrier or trader
waits for the vehicle's ask as under "Crew"; `inside` boards him at once through `boardRider`.

Results: `SetVehicle` adds a vehicle for the player, tribe, type and id; with the captain flag set it
also adds a human of the type's `logiccommander` job (`vehicletypes.ini`: 25 trader for the carts, 24
carrier for the ships, 31 for the catapult) at the vehicle's entry point, same player and tribe,
mission id the vehicle's, behaviour 0, then attaches and boards him, freeing the human when either
refuses.
`SendVehicle` and `DockVehicle` snap the point to the nearest unblocked node with the same
continent key within radius 9, then queue a goto / dock like a player click (Open Northland runs the seat
handlers directly: the goto's own radius-9 snap, and for a dock the ring search with no prior snap).
`AddGoodsToVehicle` books and stows the full amount on every matching vehicle and raises wanted as
"Cargo" describes. `AttachHumanToVehicle` resolves the first vehicle with the id and queues the
attach order for every matching human that the attach gate admits; `DetachHumanFromVehicle` queues
the detach order for every matching human. `RemoveVehicles` frees every vehicle
with the id under the script flags (no ruins, no spill). `RemoveVehiclesWithMissionId` collects at
most 50 vehicles with the id, frees every seated human and the commander first when its flag is set,
stages presentation callback 37 on the point and its two hexagon rings, and frees the vehicle.
`ChangeVehiclesPlayerId` re-attaches the vehicle to the map under the new player and explores around it; nobody aboard changes hands. `ChangeMissionIdOfVehicles`
renumbers every vehicle carrying the first id; `ChangeMissionIdOfVehiclesInRange` stamps the player's
vehicles within the range; `ChangeMissionIdOfPlayersVehiclesOnContinent` stamps the player's vehicles
not riding a carrier whose position, or for a moored ship its door entry point, carries the point's
continent byte. `MoveUnitsInArea` also collects up to 20 of the player's vehicles in the area that
ride no carrier, moves each to the destination, orders a goto there, explores around it and
stages callback 37 on both points. `ChangePlayerPlayerId` and `ChangePlayerIdInArea` include vehicles.

Goals: `GoodsInVehicles` sums the held goods over the vehicles with the id
and compares inside the loop; `FindVehicles` reads the explored bit of any such vehicle's position;
`FindPosByVehicles`, `FindHumansByVehicles`, `FindVehiclesByVehicles` and `FindHousesByVehicles`
measure hexagon distance from the vehicle's position; `IsHumanInVehicle` holds when every human with
the id is aboard and its vehicle carries the vehicle id; `FindPosByPlayersMapMoveable`
and `FindHumansByPlayersMM` run a vehicle iterator after the human one; `NumberOfVehiclesInArea` and
`NumberOfGoodsInVehiclesInArea` compare after the walk, so 0 holds.

Open Northland (`systems/missions/results/vehicles.ts`, `goals/vehicles.ts`): every result goes
through `createVehicle`, `removeVehicle` with cause `script`, `attachToVehicle`, `detachFromVehicle`,
`spawnSettler` and the owner and id stamps; the captain is the type's `commanderJob`, and a type
without one spawns bare. Named approximations: `AttachHumanToVehicle` stops at a full vehicle; a
teleported vehicle lands on the first node in hexagon-ring order within radius 9 of its own traversal
(ground for a cart, water for a ship) that its walk-block admits and is not already claimed by the same line, with its drive, held goal, mooring and guard reset
and no goto issued; callback 37 is not identified and not mirrored (*open*); `IsHumanInVehicle` reads
the `Rider` aboard state. Vehicle goals and results are unconfirmed against the 2001 original.

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
- The catapult loops its 40-frame shot over the 48-tick attack cadence while `task` is `attacks`;
  where in the clip the shot releases is an approximation.
- The stone in flight, the puff it leaves every tick and the smoke a `createsmoke` weapon raises where
  it lands are the `[particel]` records `Rock` (by `munitiontype`), its `spawnparticelId` and
  `Smoke.org` (`particles` in the IR; `packages/render/src/gpu/overlays/shot-layer.ts`). The lob and
  what it adds to the original's are described in `packages/render/src/data/scene/shot-flight.ts`.
- Ship player colour: besides the baked `human_ship01` atlas, the pipeline emits each ship library as
  an indexed atlas (`ls_vehicles.indexed`, `ve_test_ship.indexed`) and the `human_ship01..10` family as
  a ten-row LUT (`human_ship01.lut.png`), and a ship draws through `PalettedSprite` with its owner's
  row. Approximation: an owner past the tenth palette wraps around. `ve_test_ship` paints nothing from
  the band the ten palettes differ in (indices 128..159), so the viking big ship shows no owner colour.
- Wind in the sails: the original draws one rigid frame per heading. A set sail at sea ripples in the
  shader (`gpu/cloth-wind.ts`), an artistic approximation like the swell: the pixels of the sail's
  palette indices, per indexed atlas, slide sideways on a travelling wave inside the sail's fixed
  outline. `ls_vehicles` paints its sails with the cream ramp 104..111 and the owner band,
  `ve_test_ship` with the grey-cream ramp 192..207, which its deck awning shares and so ripples along
  (observations of the decoded frames). A moored ship's furled sail stays rigid.
- The ships' two hulls: action 2 (bobs 0..31 of `ls_vehicles`) has the sails set, action 4 (bobs 66..94)
  has them furled with crates on deck (observation of the baked frames). A moored ship draws the furled
  hull, a ship standing or sailing at sea the set one; the `wood` gait the rows author as the loaded
  drive is the furled hull too and plays as authored while a loaded ship sails. Which state the
  original draws action 4 in is not read; the moored reading follows the observed game.
- The ships' `gfxturnframelist` in-place turns are not played; a facing change snaps.
- A wreck's `ruins` nodes draw the `debris wood` `[GfxLandscape]` records for the bone pile's lifetime
  (approximation: the ruin landscape type is unidentified, see above).
- A handcart or ox cart whose commander rides inside and is a trader (25) or carrier (24) is not drawn
  as the cart. Its place shows the trader's driving figure, the man and his cart in one human frame:
  `[gfxwalkatomic]` job 25 with the cart good (`human_man_z00Trader_walk` for good 59,
  `human_man_z01TraderOx_walk` for 60) while it drives, `[gfxanimatomic]` action 2 or 3 standing, in the
  commander's tribe and player colours through the human palette patched by the `randompalette.ini`
  recipe `good_HandCart` or `good_OxCart` (original behavior, unconfirmed against
  the running game). The patched rows are two more blocks of the player LUT after the armor tiers
  (`packages/data/src/player-lut.ts`). A parked cart, or one whose trader walks outside to load, draws its
  own sprite, the ox cart with its all-brown `oxcart` palette; the trader or carrier outside walks as a
  civilist with the unit it carries. Only the viking records author the figure; every tribe borrows them
  (approximation: the original falls back along the job chain, not traced). The ox-less cart, ships and
  the catapult always draw their own sprite.
