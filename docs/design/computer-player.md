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
| Intel: the other seats' buildings, fighter peaks in points and zone staleness, fed by sight | `knowledge/intel/` | saved (`ComputerIntel`) |
| Map intent: the seat's objectives and forecast scripted attacks, read from the scripts | `knowledge/map-intent/` | derived |
| Strategy: economic archetype and sides, military plan and posture, each with evidence codes | `strategy/` | saved (`ComputerStrategy`) |
| Technology: requirements, apprentices, promotions, school lessons | `technology/` | derived |
| Execution: build order lines, workforce, roads, scout, population, military and operations | the other folders | saved where a plan spans decisions |

Relations between seats are always read live (`diplomacyStance`, and `fightsPlayer` while a lobby peace
holds); nothing caches who is an enemy.

## Strategy

The economic strategy is chosen from the seat brief and reviewed every few game minutes with
hysteresis. Archetypes: `standard`, `cramped` (little free ground or ground mostly under forest: compact
placement, early clearing, upgrades over copies), `rich` (room, iron and gold to spare: one more
construction site and the largest late workshop counts), `islands` (no rival on the seat's land: ship joinery first, economy kept on its own
land). The metals are weighed by amount, not only distance: the near band's deposit plus the seat's share
of its land's. Sides: `ironArms` (iron to spare: plate and mail, leather armour as the fallback),
`ironWeapons` (little iron: two smithies on long swords, iron spears and the amulets' short swords, the
army in tunics) or `naturalArms` (no reachable iron: arm from wood and tunics), `goldLine` (coins,
druids, temple), `oneMint` (little gold: one mint), `fishing`, `herbs`. The tables live in
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
stocked (`stockedAt`). Owner ruling on priorities: food, then population, then the weapons and the
joiner, then the special paths, so the gold and mushroom gatherers, the first mint and the herb hut wait
until the upper bakery, the brewery, the upper smithy and the upper joinery stand. A workshop whose
discovery the seat just earned takes the next free site, one site over the pace if need be, except that
a seat whose defence comes first gives its army and weapon lines that turn. One more workshop of a kind
the seat runs waits until those standing hold their full crews (owner ruling: upgrades and full crews
before copies), so the bread line ends on one bakery, a second where there is room, both upgraded. A
place step raises the highest tier of its chain the seat has learned, whose bill has a source and the
store backs (owner ruling: with the upper bakery learned, it is placed outright, not the lower one to
upgrade later); homes keep their step's tier, which the housing lane paces. One brewery feeds many
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
the clock's sites but one, so the one-site difficulties keep one. From the food stage on an upgrade goes
before a new home, the lowest-tier home first, and a home left below the highest tier is upgraded even
while the slots suffice. Every home without an affinity stands on the far side of the base from the
field farms, off their fields, so the mill, animal farm and bakery find room beside the farm. It follows
food (owner ruling: an upgraded home bears no children while food is short): no home site while the
store holds under one child's food a woman; a food-rich seat (fishing, or five meals a settler in store)
may run it from the start of the opening while the daughters are blocked; any other seat opens it behind
the pottery, school and mason once a workshop making food (animal farm, bakery) stands.

The seat plays under the same experience gates as a human (`docs/formats/PROGRESSION.md`); with the
match's progression toggle off everything is open for both. The first discovery of a trade always comes
from work: the technology module pins an apprentice on the work that credits the needed track and
promotes him into the new building when it stands, refilling his old post. Once a school stands, further
workers of a discovered trade are schooled instead. Owner ruling on the opening: one wood, one clay and
one stone collector, a second stone collector early, a hunter and a farmer, the school once the pottery
stands, iron from game minute 15, mushrooms from minute 25. An operator whose every listed product is
still locked for him learns one of them at school (the one he lacks the most repeats for) instead of
grinding the weaker product he has earned: a fresh smith otherwise forged about ten short swords before
his first long sword.

The seat switches the settlement assistant on as a player would (owner ruling): mead, shoes and both
tools for every settler, since the adults live on mead and the bread feeds the children; the healing
potions and every amulet for the soldiers alone; gatherers moving their flags. Posting graduates stays
off: the seat schools a man for one post and puts him there itself, where the switch would bind him to
the nearest free slot of his trade, a workshop the seat keeps short on purpose included.

Smithies, armouries, tailors and mints choose their products from stock (`workforce/craft.ts`,
`workforce/craft-stock.ts`; owner ruling): each type keeps an ordered list of wants, army goods held to
the recruits still to arm plus a wave's reserve, input goods to one unit per operator that consumes
them, coins to two per druid, shoes and iron tools to a fixed stock. Every want under its target takes
one operator, the most lacking army want first, the spare men follow the largest lack, and a crew with
nothing wanted rests, so iron waits for the next want. A weaker good is made only to arm the army or
earn the better one: wooden tools, short bows, holy oil and coins before the amulets, and short swords
and wooden spears beyond that only as the strength amulet's and the iron spear's inputs. Nobody makes
furniture. A seat with iron dresses its army in plate and mail, leather armour only before plate and as
the defence amulet's input; a seat with little or none sews tunics and shoes and no leather armour. The
druids boil holy oil only until the big healing potion is learned and brew only that afterwards. Extra
gatherer posts are released at their good's glut, and gatherers never take the builders a seat's open
sites need. On a seat with iron to spare the iron posts its smithies plan come ahead of the builder
reserve, its consumers' input shelves do not count as iron to spare, and its iron gatherers are never
called to arms. Porters: one for the headquarters and each warehouse, last in the ladder, and two for
the barracks, both from the late game; one for the animal farms, the tailors and the tools joineries
from the start. The builder reserve grows with the civilians past 60 (a sixteenth of them on hard). A
cramped seat digs room with three extra wood and two extra stone collectors from the start, a standard
one with two and one from game minute 10.

## Military

Each seat has a military deadline (`military/deadline.ts`): the end of its lobby peace, 60 minutes
without one, or the first forecast scripted attack, whichever comes first. The barracks waits until 22
minutes before it, so it stands about 15 minutes ahead, the first tower ring until 20 minutes before, the
army floor drafts from 15 minutes before. A seat whose defence comes first raises its barracks and towers
at once; its army floor still waits for its lead unless the seat is under attack. A seat that starts with
soldiers and no barracks turns them all into builders in its first game minute (owner ruling: they build
more, and defend as hunters and in defensive mode).

The tower ring is a lane, two sites at a time, three while the seat's defence comes first, standing
beyond the site clock on hard. Where attacks come before game minute 60 it raises the cheap lower tier
(owner ruling: it builds far faster) and the standing towers are upgraded once the seat makes bricks and
pillars; elsewhere, and from minute 60 everywhere, it raises the upper tier outright once learned and
sourced. Facing forecast scripted attacks the ring is timed per wave (owner ruling: the towers finish a
bit before each attack): three towers from 20 minutes before the first deadline, two more before each
later one, and it first fills a line across the attack's heading 16 nodes ahead of the base (whole steps
further past its start buildings), two rows on a seat whose defence comes first; the seat's economy is
placed behind that line while anything fits there. The catapult joinery is the line's last step and
waits for 200 settlers and the late game (owner ruling: late late game). A seat sends two hunters at
each attacking wild animal it sees within reach of its buildings, unowned or owned by a player it fights
(mroczny_las's wolves belong to the map's forest seat), and at any such animal biting one of its people
anywhere, hiring up to two more from its spare men while the threat lasts; beasts stronger than two bows
(lions) are left to the towers and the army. The draft mans each standing empty tower with its first
archer before it fills the field army, since a tower shoots only through its garrison.

Settlement defence is shared with the map AI (`systems/ai-shared/military`), filtered by sight for a
computer seat. Offensive work runs as operations (`military/operations/`): saved records with a kind,
members, target and a lifecycle (`forming`, `moving`, `acting`, `withdrawing`, `done`, `failed`). The
wave march is the `assault` kind: the wave walks to a gathering point short of the enemy base and out
of its known towers' reach, waits there until three quarters of it have arrived (at most 45 seconds after
the first, 5 minutes after setting out), then goes in as one group attack-move while its catapults take
the towers by the objective. A `raid` sends a small band, archers first, around the flank to the
gatherers at the edge of an enemy base and withdraws when defence answers. A new behaviour such as
supporting an ally is one more kind with its handler.

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
