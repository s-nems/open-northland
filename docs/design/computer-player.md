# Computer player

The autonomous computer player (`packages/sim/src/systems/computer-player`) runs a seat the way a
player who knows the map would: it reads the map once, picks an economic strategy and a military plan,
climbs the technology tree through experience and schools, and acts only on what it can see. Its
orders are ordinary player commands, so they replay, hash and log like a human's. The scripted map AI
(`systems/map-ai`) is a separate controller and keeps the original's behaviour.

Most choices here are authored policy, not extracted data. Comments name their basis: "owner ruling"
for rules the project owner set from how good players play, "authored" for tuned values with the
real-map figures behind them.

## What a seat may know

A computer seat knows the static map (terrain and the start layout of resources and landscape), every
seat's start position and start buildings, and the complete map scripts. What other players do during
the game reaches it only through its own sight (`ctx.fog`, `systems/vision/gates.ts`), plus what it
remembers. With fog off everyone sees everything, the seat included. The scripted map AI is not bound
by this rule.

`packages/sim/test/systems/computer-player/` holds a differential test: enemy entities placed out of
the seat's sight must not change one of its commands.

## Layers

| Layer | Folder | State |
| --- | --- | --- |
| Map brief: one scan of the static map in 32-node zones (ground, deposits, fish, land components, seat starts) | `knowledge/map-brief/` | saved (`MapBrief`) |
| Seat brief: the map seen from one seat (home and near bands, access to iron, gold, mushrooms, fish, the other starts) | `knowledge/seat-brief.ts` | derived |
| Intel: the other seats' buildings, fighter peaks in points, zone staleness and where the seat lost a scout, fed by sight | `knowledge/intel/` | saved (`ComputerIntel`) |
| Map intent: the seat's objectives and forecast scripted attacks, read from the scripts | `knowledge/map-intent/` | derived |
| Strategy: economic archetype and sides, military plan and posture, each with evidence codes | `strategy/` | saved (`ComputerStrategy`) |
| Technology: requirements, apprentices, promotions, school lessons | `technology/` | derived |
| Execution: build order lines, workforce, roads, scout, population, military and operations | the other folders | saved where a plan spans decisions |

Relations between seats are always read live (`diplomacyStance`, and `fightsPlayer` while a lobby peace
holds); nothing caches who is an enemy. An islands seat declares war on every neutral match player once
any lobby peace ends, since island seats that wait to be declared on never fight (owner ruling).

## Strategy

The economic strategy is chosen from the seat brief and reviewed every few game minutes with
hysteresis. Archetypes: `standard`, `cramped` (little free ground or ground mostly under forest: compact
placement, early clearing, upgrades over copies), `rich` (room, iron and gold to spare: one more
construction site and the largest late workshop counts), `islands` (no rival on the seat's land: ship
joinery first by the shore, passed over while its tier is locked, economy kept on its own land). The metals are weighed by amount, not only distance: the near band's deposit plus the seat's share
of its land's. Sides: `ironArms` (iron to spare, 2,200 units or more within reach, which leaves
krwawa_rzeka and specjalna_forteca on weapons only: plate and mail, leather armour as the fallback),
`ironWeapons` (little iron: two smithies on long swords, iron spears and the amulets' short swords, the
army in tunics) or `naturalArms` (no reachable iron: arm from wood and tunics), `goldLine` (coins,
druids, temple), `oneMint` (little gold: one mint), `noRoom` (under 10,000 free nodes on the seat's
whole land, an island start that can never grow: one of each workshop, six homes, no catapults, owner
ruling), `fishing`, `herbs`. The tables live in
`build-order/seat-order.ts` and `workforce/craft.ts`.

The military plan (`aggressive`, `defensive`, `harasser`, `balanced`) is drawn once per seat from the
seeded RNG. The posture (`defend`, `attack`, `harass`, `prepare`) is reviewed every few decisions from
own points against believed enemy points, forecast scripted attacks, the seat's plan and its
objectives. Execution reads the posture through `militaryOrdersOf`: wave launch ratio, army floor and
draft share, raids allowed, tower density.

Strength is counted in points per fighter, derived from the content's weapon damage matrix against
armour materials, hitpoints, and visible buffs (amulets, potions, the temple). A weapon is ranked within
its weapon class, so a short bow, a short sword and a wooden spear weigh alike; chain and plate weigh
the same.

## Economy

The build order is a set of independent lines (opening, bread, brewery, clothing, tools, weapons,
armory, materials, military, coins, healing, homes, in the standard priority). A step waits for the step
before it in its line; lines never wait for each other, and a priority table chosen from the strategy
decides who takes a free construction site. A step whose building is not discovered yet holds its own
line while the discovery can still come; one that can never come (a map ban, no game to hunt, no
deposit) is skipped. A step may also hold its line on a building standing, a good discovered, the seat's
settler count or the military deadline (`holdUntil`), and a gatherer step may pause while its good lies
stocked (`stockedAt`). A gatherer step holds its own line's sites but never the housing or coverage
lanes behind it: its man comes from spare men, which a seat of few men may lack for an hour. Owner ruling on priorities: food, then population, then the weapons and the
joiner, then the special paths, so the gold and mushroom gatherers, the first mint and the herb hut wait
until the upper bakery, the brewery, the upper smithy and the upper joinery stand. A workshop whose
discovery the seat just earned takes the next free site, one site over the pace if need be, except that
a seat whose defence comes first gives its army and weapon lines that turn, its barracks taking the extra
site over the pace once its deadline lead opens. A seat whose food production is missing (no bakery
stands, no fisher fishes) gives the first building of each food chain kind it lacks the next free site,
right after the due steps and ahead of the lanes, the towers and the other crafts (owner ruling); such a
step takes the extra site only as an earned workshop. The school is a core step: it takes an earned
workshop's turn and extra site once no food turn waits. The bread chain goes mill, well beside it, bakery
(owner ruling): the farmer who earned the mill runs it and the miller who earned the bakery bakes, and
every builder works the chain's open site (`workforce/focus-crew.ts`), up to one per unit of its bill.
Another site holding delivered material or two thirds of its bill keeps one builder, and the pins lift
while the chain's site lacks a good the store does not hold. A placement held on the
military deadline, the barracks among them, goes ahead of the earned workshops once its lead opens and
may take their extra site (owner ruling: the barracks stands a bit before the deadline). One more workshop of a kind
the seat runs waits until those standing hold their full crews (owner ruling: upgrades and full crews
before copies), so the bread line ends on one bakery, a second where there is room, both upgraded. A
copy step capped to one is dropped, so an upgrading building never gets a second beside it. A
place step raises the highest tier of its chain the seat has learned, whose bill has a source and the
store backs (owner ruling: with the upper bakery learned, it is placed outright, not the lower one to
upgrade later); homes keep their step's tier, which the housing lane paces. A site upgrading is no
source of a good its own bill still lacks; an upgrade waiting on such a good with no other maker and no
free stock of it is called off, so the workshop makes the good again. A building paper the map hands
the seat is spent on a placement it fits, which then stands finished at once: a paper naming a tier of
the step's chain at or above the chosen one, the highest first, else an any-building paper on the tier
with the dearest bill any placing step raises (owner ruling). A step a named paper covers is placed at
once, ahead of any site pace, turn or hold, and its workshop's slot goes first to a spare man already
holding its trade (owner ruling: the map means that line to stand at the start). One brewery feeds many
adults (owner ruling): the second waits for 100 settlers, the third, the last, for 200. The armory goes
up right after the first smithy in a line of its own; one armory with two armourers lasts long, so the
second waits for 200 settlers. Once the smith has learned mail and plate, a seat with iron to spare
raises its second to fourth upper smithy at once, ahead of the crew wait, then up to six on a rich seat;
one with little iron stops at two. A copy placed ahead of the crew wait takes a free site like a new
kind of building. A seat dressing its army in tunics raises both tailors at once, its clothing line
ahead of its tools, and its second animal farm right after the first, and upgrades both tailors at once
(two tailors on shoes, two on tunics, its breeders split between cattle and sheep); a seat with iron
puts its tools line ahead of its clothing. A second and third mint follow, on a seat with gold to spare,
once the coiner has learned the amulets, and further druid huts once the druid has learned the big
healing potion. The late targets per archetype (owner ruling for a rich seat: 3 mints, 3 breweries, 6
druid huts, 6 smithies, 2 armories, 14 homes, 4 upper bakeries, the third and fourth bakery at 150 and
220 settlers) are pinned in `build-order/seat-order.ts`; a standard seat stops at 10 homes and 2
bakeries, a cramped one at 8 homes and 1 bakery. A seat that lost its base raises one warehouse, the top
tier it can source, where its start headquarters stood, and nothing else until it stands (owner ruling).

Homes are not fixed steps beyond the opening's three, four on a seat with room and five on a rich one: a
housing lane (`build-order/housing.ts`) keeps the homes' family slots ahead of the women, girls and
booked daughters. Its pace follows the food stage (owner ruling): before any workshop makes food or a
fisher fishes it keeps two slots ahead on one home site, upgrading or placing whichever adds a slot
cheapest; while only the animal farm feeds the seat it keeps that pace and raises one home to the third
tier, two with food in store or game to hunt, and no home, new or upgraded, higher; once the first
bakery stands or a fisher fishes it keeps four ahead on two sites; once the brewery and an upper-tier
bakery stand, eight ahead on three. Home sites past the first stand beyond the clock's sites, at most
the clock's sites but one, so the one-site difficulties keep one; a tower ring's sites standing apart
never count against them. From the food stage on an upgrade goes before a new home, the lowest-tier home
first, and a home left below the highest tier is upgraded even while the slots suffice. A second upgrade
starts only while the standing homes still keep a slot free past the women's demand, otherwise the lane
places a new home, and no upgrade climbs past a tier whose own bill nothing the seat makes. It follows
food (owner ruling: an upgraded home bears no children while food is short): no home site while the
store holds under one child's food a woman, unless a staple source works (a staffed workshop making food
or a fisher) and the female demand stays under four per working food source, hunters included; a food-rich seat (a hired fisher, or five meals a settler in store)
may run it from the start of the opening while the daughters are blocked; any other seat opens it behind
the pottery, mason and school once a workshop making food (animal farm, bakery) stands.

Placement (`build-order/placement.ts`) takes only a spot within a fair walk of the base door, at most
twice the straight line plus 8 tiles (`spot-walk.ts`), never one near only as the crow flies across a
river bend. Owner rulings keep the farm's ground for its chain: the grain farm is scored by the free
ground around it for the animal farm, mill, two bakeries and a well, paying rings of distance for room
it lacks; every home without an affinity, and the school, stands on the far side of the base from the
field farms; a workshop pulled to a deposit goes to the one its gatherers work and pays a few rings for
a spot beside a field farm.

The seat plays under the same experience gates as a human (`docs/formats/PROGRESSION.md`); with the
match's progression toggle off everything is open for both. The first discovery of a trade always comes
from work: the technology module pins an apprentice on the work that credits the needed track and
promotes him into the new building when it stands, refilling his old post. Once a school stands, further
workers of a discovered trade are schooled instead. Owner ruling on the opening: one wood, one clay and
one stone collector, a second stone collector early, a hunter and a farmer, the mason hut, then the school (its bill
wants his pillars) once the pottery stands, iron from game minute 15, mushrooms from minute 25. The first
wood, stone and clay flags stand as close to their resource as a legal node allows, and in the first 30
game minutes single builders wed first, so the bride walks to him and the gatherers stay at work. An operator whose every listed product is
still locked for him learns one of them at school (the one he lacks the most repeats for) instead of
grinding the weaker product he has earned: a fresh smith otherwise forged about ten short swords before
his first long sword.

The seat switches the settlement assistant on as a player would (owner ruling): mead, shoes and both
tools for every settler, since the adults live on mead and the bread feeds the children; the healing
potions and every amulet for the soldiers alone; gatherers moving their flags. Posting graduates stays
off: the seat schools a man for one post and puts him there itself, where the switch would bind him to
the nearest free slot of his trade, a workshop the seat keeps short on purpose included. The grants
skip a recruit whose weapon is still unpaid, so he never goes out for mead before he is armed.

Smithies, armouries, tailors and mints choose their products from stock (`workforce/craft.ts`,
`workforce/craft-stock.ts`; owner ruling): each type keeps an ordered list of wants, army goods held to
the recruits still to arm plus a wave's reserve (two waves of iron arms on an iron-arms seat from the
barracks lead on), input goods to one unit per operator that consumes
them, coins to two big potions' worth per druid (so the whole mint strikes coins until the druids are
covered, the amulets after), shoes and iron tools to a fixed stock. Every want under its target takes
one operator, the most lacking army want first, and the spare men follow the largest lack. A man past
every want makes a surplus good rather than rest (owner ruling), the army's first, in turn, only from
inputs at their comfort line, so he never eats the wood or stone the sites want. On an iron-arms seat
the smith past every want keeps forging long swords (short ones before the long sword is earned) until
chain mail, which opens the upper smithy, is earned. A weaker good is made only to arm the army or
earn the better one: wooden tools, short bows, holy oil and coins before the amulets, and short swords
and wooden spears beyond that only as the strength amulet's and the iron spear's inputs. Nobody makes
furniture. A seat with iron dresses its army in plate and mail, leather armour only before plate and as
the defence amulet's input; a seat with little or none sews tunics and shoes and no leather armour. The
druids boil holy oil only until the big healing potion is learned and brew only that afterwards. Extra
gatherer posts are released at their good's glut, and gatherers never take the builders a seat's open
sites need. The posts of the goods the sites build with and the food (each food chain workshop's first
hand ahead of the core builders, owner ruling, then the hunters and fishers) come first, then two core
builders, then the other goods' posts (ore among them), the buildings' first hands and the scout. A seat
short of its core returns its generic posts, its free scout and the gatherers of goods the sites do not
build with to the pool. While a placement finds no spot the builder reserve keeps the open sites' pairs,
at least four, and the clearing posts yield the men those builders lack; the generic posts clear first
the trees and rocks on the patch the stalled building (the top line's holding step) would take with the
fewest blocked nodes. While an input of a workshop runs short for the sites, at any clock, the workshop
rests once none of its products is short, so the scarce good goes to the sites; otherwise a glutted
workshop keeps its first craftsman for his experience from the core-crew time. An apprentice works past
his glut, since a resting man earns no repeats. A good whose every collector step stands stocked keeps
no base post either, so the clay gatherer goes back to the builders while clay piles up. A fisher's flag goes only where the store's carriers walk to it within the trip, not round
a long river bend. Each druid hut posts its own mushroom gatherer, who banks them on its shelf, an upper
hut a second out of surplus. On a seat with iron to spare the iron posts its smithies plan come ahead of the builder
reserve, its consumers' input shelves do not count as iron to spare, and its iron gatherers are never
called to arms. Porters: one for the headquarters and each warehouse, last in the ladder, and two for
the barracks, both from the late game; one for the lower smithy until chain mail is earned; one for the animal farms, the tailors and the tools joinery once
the builder reserve stands, and one for the handcarts' joinery ahead of it, which also fills its third
joiner (owner ruling: iron tools and handcarts are always short). The builder reserve grows
with the civilians past 60 (a sixteenth of them on hard). A cramped seat digs room with three extra wood
and two extra stone collectors from the start, a standard one with two and one from game minute 10.

## Military

Each seat has a military deadline (`military/deadline.ts`): the end of its lobby peace, 60 minutes
without one, or the first forecast scripted attack, whichever comes first. The barracks waits until 22
minutes before it, so it stands about 15 minutes ahead, the first tower ring until 30 minutes before and
until the barracks is placed (owner ruling: the barracks shoots like a tower and trains the army; the
ring rises at the upper tier where attacks come late), the army floor drafts from 15 minutes before. A
seat whose defence comes first raises its barracks and towers at once; its army floor still waits for its
lead unless the seat is under attack. Defence comes first while the seat fights off an attack, prepares
against a forecast attack or knows one within the barracks lead, or, against a stronger enemy alone, once
the clock is within the barracks lead of its deadline (owner ruling: food before arms). A seat that starts with soldiers and no barracks turns them all
into builders in its first game minute (owner ruling: they build more, and defend as hunters and in
defensive mode).

The tower ring is a lane, two sites at a time, three while the seat's defence comes first, standing
beyond the site clock on hard; a tower site opens only while the open sites stay under a third of the
seat's men, at least one. Where attacks come before game minute 60 it raises the cheap lower tier
(owner ruling: it builds far faster) and the standing towers are upgraded once the seat makes bricks and
pillars, though none opens within 15 minutes of a forecast attack (an upgrading tower shoots no one);
elsewhere, and from minute 60 everywhere, it raises the upper tier outright once learned and sourced.
The ring places by defence (`build-order/tower-defence.ts`): each headquarters, barracks and tower adds
its garrison over its house bow's reach, and the opening ring wants a defence of 10 over every building
and 30 over the front (owner ruling: the village under a minimum defence, the front under a stronger one), 70
percent more while the seat's defence comes first. A tower goes where it lifts the least covered target
most, at least half a circle from every defence building; from minute 60 the upgrade of a lower tower
that lifts a short target goes ahead of a new tower (owner ruling).
Facing forecast scripted attacks the ring is timed per wave (owner ruling: the towers finish a bit before
each attack): three towers from 20 minutes before the first deadline, two more before each later one;
its front is a line across the attack's heading 16 nodes ahead of the base (whole steps further past
its start buildings), and while the seat's defence comes first every building facing the attack counts
as front. Only this scripted line also keeps
the seat's economy placed behind it while anything fits there. Without a forecast attack, or with its
origin within those 16 nodes of the base, the ring's line faces the nearest believed enemy building
instead, 10 nodes past the seat's farthest building and moving out in 8-node steps, so the town has room
to grow behind it (owner ruling). A seat whose enemy
groups (a team counts as one) lie more than about 45 degrees apart from its base holds no single front:
no rival line is drawn, and the barracks and every front-pulled spot stay by the base (owner
ruling). Once the economy is safe (the brewery and the upper bakery stand and game minute 60 has
passed) a second, settled ring opens, wanting 20 over every building and 40 over the front, both rings
sharing one site pace (owner ruling: later in the game towers cover the whole settlement). The catapult joinery is the line's last step and
waits for 200 settlers and the late game (owner ruling: late late game). A seat sends two hunters at
each attacking wild animal it sees within reach of its buildings, unowned or owned by a player it fights
(mroczny_las's wolves belong to the map's forest seat), and at any such animal biting one of its people
anywhere, hiring up to two more from its spare men while the threat lasts; beasts stronger than two bows
(lions) are left to the towers and the army. The draft mans each standing empty tower with its first
archer before it fills the field army, since a tower shoots only through its garrison. Arming reads the
stock its errands can fetch, what the stores reachable from the barracks door lend, not the seat stock,
which also counts goods in hands, kept aside for an upgrade or lying past the network. No armed class
takes more men than those weapons less its recruits already waiting for one, the bare soldiers and the
tower archers served first, and a class the seat can no longer arm releases its waiting recruits to be
armed for another. The scout keeps out of a zone where the seat lost one within 30 game minutes, and off
any target whose straight walk crosses it (owner ruling: scout after scout into a wolf den feeds the wolves).

Only fit soldiers are the seat's army (owner ruling): armed, and dressed while its arms side dresses the
army and armour lies within reach; a tower archer and a trade that wears no armour need none. Its own
points, raids and waves count only them, and the draft floor counts armed fighters and recruits in drill,
never a bare soldier. The rest wait at the barracks door, where the seat dresses them with the player's
equip order, three each decision, the best armour within reach first, since the assistant dresses a
recruit only when his weapon lands. Each finished
barracks marks the seat's weapons, armour, healing potions, mead and amulets as store priority, so its
porters fetch the army's gear.

Settlement defence is shared with the map AI (`systems/ai-shared/military`), filtered by sight for a
computer seat. An outmatched seat (its posture review found the strongest enemy clearly stronger) sorties
only for raiders at its towers and stores, and its army waits at its base door, not at a barracks on the
front (owner ruling: survive at any cost); recruits awaiting a weapon stay at the barracks. A seat
awaiting a scripted or map-AI attack stands its army 10 nodes behind its manned towers facing the attack
(`military/tower-stand.ts`), and meets a band of 4 or more only within those towers' reach or at its
stores (owner ruling: the army meets big attacks together under the tower line). Offensive work runs as operations (`military/operations/`): saved records with a kind,
members, target and a lifecycle (`forming`, `moving`, `acting`, `withdrawing`, `done`, `failed`). The
wave march is the `assault` kind: the wave walks to a gathering point short of the enemy base and out
of its known towers' reach, waits there until three quarters of it have arrived (at most 45 seconds after
the first, 5 minutes after setting out), then goes in as one group attack-move while its catapults take
the towers by the objective. A `raid` sends a small band, archers first, at the gatherers or economy
buildings of an enemy player, never a map-scripted camp. A harassing posture raids; a hard seat off an
island start also sends a flank raid after its peace, eight minutes after the last one ended, except while it defends or
prepares against a forecast attack (owner ruling). The band walks a route clear of believed towers' reach, coming in from the
side, without stopping to fight, strikes, and comes home the way it came; it turns back when the way or
target falls in a tower's reach, a building near it switches to defence, the fighters and militia it
sees outweigh it, or it loses half its men. A new behaviour such as supporting an ally is one more kind
with its handler.

Over the sea (`military/operations/landing.ts`, `sea-scout.ts`), the ship joinery builds small ships up
to the landing fleet (`workforce/craft.ts`): the planned army, the army cap times the plan's draft share,
at 20 soldiers a ship, 2 to 10 ships (owner ruling); a yard still building does not count toward it, and
the crafts leave the missing ships' leather and other ungathered bill goods in stock. A `landing` opens
once the posture attacks and the peace is over: the free men must load at least 4 free moored ships, or
the whole fleet when smaller but never under 2, each to 90 percent (owner ruling: ships go only on big
landings). The fleet casts off together, the first ship moored waits up to a minute for the rest, every
man but each commander lands, and the ships sail home; a ship refused its berth docks at another shore
of that land. The wave turns back on heavy ship losses or when the enemy seen at the shore outweighs it,
and the next landing waits 5 minutes. A seat whose rival lies over the sea weighs its posture against
him; a defensive one attacks from 80 fit soldiers at parity with the believed defence, not the plan's
edge, which it cannot measure over the sea (owner ruling). A `seaScout` sails one ship, the highest-id free one, with the weakest free soldier
round the rival's island outside his believed towers, while the peace is over, no landing runs and the
rival's headquarters is out of sight, then docks home, at another home shore if its own is taken; the
next trip waits 8 minutes.

A `hold` takes an area the map pays for holding. The map intent reads one from the script's shape, not
the map id: a presence goal on a repeating timer whose mission hands over goods a deciding deliver
objective counts becomes a `holdArea` objective with its centre, range and reward cadence. On
diamentowa_dolina every 5-minute check pays each seat with people within 13 map points of the centre one
amulet at its team's corner, and ten of one seat's amulets win for the team. Past the military deadline
and any lobby peace, a band of the plan's share of the men past the home floor, and more until it is
clearly stronger than the defence the seat believes there, marches to the area and keeps its men
inside; it draws reinforcements as the enemy it sees grows, and withdraws when outmatched or after heavy
losses, retrying after a cooldown. A seat whose start lies in the area counts with its whole believed
army; when no computer player runs it and its map program names no attack, it never leaves the area, so
the posture review does not count it as a threat to the home. A friend's people in the area with no
enemy leave it to him. On a map won by holding an area, a seat with no stronger enemy and no forecast
attack prepares: its army builds up at home for the hold and marches nowhere else. A clearly stronger
enemy or a forecast attack stops holds; a raid on the settlement only keeps a new hold from forming.

## Difficulty

One brain at every level. `difficulty.ts` throttles the lower levels (construction sites, builders,
children, building caps, catapults, army cap and first wave); hard is unthrottled. No level gets extra
sight or resources.

## Cadence and cost

Each seat decides on its own slot every 48 ticks, its modules spread over consecutive ticks. The map
brief is one scan when the first computer controller runs (tens of milliseconds on the largest focus
maps). Intel, strategy and operations work scales with the other seats' buildings and fighters, never
with every entity.

## Inspecting a seat

The admin debug panel's AI tab shows each computer seat's strategy and evidence, the seat brief, own
and believed enemy points, remembered buildings, zone staleness, objectives and forecast attacks, its
live operations, and the discoveries it works toward with the apprentice pinned on each.
