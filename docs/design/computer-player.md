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
placement, early clearing, upgrades over copies), `rich` (more construction sites and copies),
`islands` (no rival on the seat's land: ship joinery first, economy kept on its own land). Sides:
`ironArms` or `naturalArms` (no reachable iron: arm from wood and tunics), `goldLine` (coins, druids,
temple), `fishing`, `herbs`. The tables live in `build-order/seat-order.ts`.

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
materials, military, coins, healing, homes, in the standard priority). A step waits for the step before
it in its line; lines never wait for each other, and a priority table chosen from the strategy decides
who takes a free construction site. A step whose building is not discovered yet holds its own line while
the discovery can still come; one that can never come (a map ban, no game to hunt, no deposit) is
skipped. A step may also hold its line on a building standing, a good discovered or the military
deadline (`holdUntil`), and a gatherer step may pause while its good lies stocked (`stockedAt`). A
workshop whose discovery the seat just earned takes the next free site, one site over the pace if need
be, except that a seat whose defence comes first gives its army and weapon lines that turn. Homes are not fixed
steps: a housing lane (`build-order/housing.ts`) keeps the homes' family slots ahead of the women, girls
and booked daughters, one home site at a time, upgrading or placing whichever adds a slot cheapest.
It follows food (owner ruling: an upgraded home bears no children while food is short): no home site
while the store holds under one child's food a woman; a food-rich seat (fishing, or five meals a settler in
store) may run it from the start of the opening while the daughters are blocked; any other seat opens
it behind the pottery, school and mason once a workshop making food (animal farm, bakery) stands.

The seat plays under the same experience gates as a human (`docs/formats/PROGRESSION.md`); with the
match's progression toggle off everything is open for both. The first discovery of a trade always
comes from work: the technology module pins an apprentice on the work that credits the needed track
and promotes him into the new building when it stands, refilling his old post. Once a school stands,
further workers of a discovered trade are schooled instead. Owner ruling on the opening: one wood, one
clay and one stone collector, a second stone collector early, a hunter and a farmer, the school right
after the pottery, iron from game minute 15, mushrooms from minute 25.

The workshops' product plans (`workforce/craft.ts`) follow the same rulings: a seat with iron sews
leather and shoes from its cattle, one without breeds sheep for woollen armour; a druid brews oil until
he learns the small healing potion and only big potions once he knows them; the first coiner strikes
coins until he learns amulets; joineries turn to furniture once tools pile up. Extra gatherer posts are
released at their good's glut, and gatherers never take the builders a seat's open sites need.

## Military

Each seat has a military deadline (`military/deadline.ts`): the end of its lobby peace, 60 minutes
without one, or the first forecast scripted attack, whichever comes first. The barracks waits until 22
minutes before it, so it stands about 15 minutes ahead, the first tower ring until 20 minutes before, the
army floor drafts from 15 minutes before; a seat whose defence comes first stops waiting at once.

Settlement defence is shared with the map AI (`systems/ai-shared/military`), filtered by sight for a
computer seat. Offensive work runs as operations (`military/operations/`): saved records with a kind,
members, target and a lifecycle (`forming`, `moving`, `acting`, `withdrawing`, `done`, `failed`). The
wave march is the `assault` kind. A `raid` sends a small band, archers first, around the flank to the
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
enemy leave it to him. Defending or preparing for a forecast attack stops holds; a defensive plan holds
only while it attacks.

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
