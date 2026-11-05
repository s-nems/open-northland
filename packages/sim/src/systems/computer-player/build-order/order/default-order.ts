import { LATE_GAME_FROM_TICKS, LATE_LATE_GAME_SETTLERS, minutesToTicks } from '../../game-phase.js';
import type { BuildOrder, BuildOrderEntry, PlacementAffinity, StepHold } from './entries.js';
import { MILITARY_LINE } from './military-line.js';

/** How near a water-drinking workshop (the bakery, the brewery, the animal farm) a well must stand to
 *  serve it, in world-metric nodes (authored); a farther one gets another well beside the workshop. */
export const WELL_REACH_NODES = 12;

/** How near a brewery its hive must stand to count as its honey source, in world-metric nodes (authored):
 *  wider than the well's reach, since the well entry serving the same brewery comes first in the list and
 *  takes the nearest room, and the brewer's carrier walks the little further for honey. */
const HIVE_REACH_NODES = 18;

/** How far a store's coverage reaches, in world-metric nodes (authored): well over a tower's, since a
 *  warehouse serves carriers rather than bows, and the base is a store too. */
const STORE_COVERAGE_RADIUS_NODES = 32;

/** The most homes the housing lane raises (owner ruling): about fourteen top-tier homes on a rich seat.
 *  The other archetypes cap it lower (`./seat-order.ts`), and the room their land holds lifts them up to
 *  it (`../ground/room.ts`): a bigger settlement makes a stronger player on every plan. */
export const HOUSING_HOMES_CAP = 14;

/** The two deposits a joinery or a smithy draws on, in the order its recipes weigh them. */
const WOOD_AND_IRON: readonly PlacementAffinity[] = [
  { kind: 'resource', good: 'wood' },
  { kind: 'resource', good: 'iron' },
];

const IRON_AND_WOOD: readonly PlacementAffinity[] = [
  { kind: 'resource', good: 'iron' },
  { kind: 'resource', good: 'wood' },
];

/** A well beside the first `building` with none in reach; the entry is skipped once every such building
 *  has one. `cap` only caps the seat's wells: one for the opening mill and bakeries and one for every
 *  other water-drinking building the order raises up to this step, counted as if the lines ran one after
 *  another, so it bounds the wells rather than matching the other lines' progress. */
function wellBeside(building: string, cap: number): Extract<BuildOrderEntry, { kind: 'place' }> {
  return {
    kind: 'place',
    building: 'work_well_00',
    count: cap,
    near: [{ kind: 'building', id: building }],
    unlessWithin: { building, radius: WELL_REACH_NODES },
  };
}

/** The mason hut, by the stone its gatherers work. */
const MASON_HUT: Extract<BuildOrderEntry, { kind: 'place' }> = {
  kind: 'place',
  building: 'work_mason_hut_00',
  count: 1,
  near: [{ kind: 'resource', good: 'stone' }],
};

/** The wells the seat may own when the bread line raises one beside its mill (authored): the mill's own,
 *  and one more the seat may own already out of the mill's reach. */
const OPENING_WELLS_CAP = 2;

/** Owner ruling: the adults live on mead and one brewery feeds many of them, so a further brewery waits
 *  for the people to drink it, but not too long. Authored figures from magiczny_las at game minute 90: two
 *  breweries piled 87-158 mead at 101-209 settlers, while one left 0-11 in store at 120-175 on most seats,
 *  so the second comes from 100 settlers, standing by about 120, and the third from 200. */
const SECOND_BREWERY_FROM_SETTLERS = 100;

const THIRD_BREWERY_FROM_SETTLERS = 200;

/** Owner ruling: a rich seat bakes in about four upper bakeries, the third and fourth, like the breweries,
 *  once the people eat that much bread. Authored figures: magiczny_las seats counted 128-279 settlers at
 *  game minute 90, so the third comes from 150 on most rich seats by then, the fourth from 220 on the
 *  larger ones. */
const THIRD_BAKERY_FROM_SETTLERS = 150;

const FOURTH_BAKERY_FROM_SETTLERS = 220;

/** Owner ruling: one armory with two armourers and a porter lasts very long, so the second comes only in
 *  the late late game. */
const SECOND_ARMORY_FROM_SETTLERS = LATE_LATE_GAME_SETTLERS;

/** The `count`th brewery beside the others once the seat counts `fromSettlers` settlers, then a hive and a
 *  well beside it unless theirs stand in reach. */
function breweryWithHiveAndWell(count: number, wellCap: number, fromSettlers: number): BuildOrderEntry[] {
  return [
    {
      kind: 'place',
      building: 'work_brewery',
      count,
      near: [{ kind: 'building', id: 'work_brewery' }],
      holdUntil: { kind: 'settlers', count: fromSettlers },
    },
    {
      kind: 'place',
      building: 'work_hive_00',
      count,
      near: [{ kind: 'building', id: 'work_brewery' }],
      unlessWithin: { building: 'work_brewery', radius: HIVE_REACH_NODES },
    },
    wellBeside('work_brewery', wellCap),
  ];
}

/** The seat makes the big healing potion. */
const BIG_POTION: StepHold = { kind: 'good', good: 'potion_heal_big' };

/** The coiner has learned the amulets: the strength and the defence amulet share one discovery threshold. */
const AMULETS: StepHold = { kind: 'good', good: 'amulet_strength' };

/** Owner ruling: food first, then the people, then the weapons and the joiner, and only then the special
 *  paths: the gold and mushroom gatherers, the first mint and the herb hut wait until the upper bakery, the
 *  brewery, the upper smithy and the upper joinery stand. A building the seat can never raise (the smithy of
 *  a seat without iron) drops out of the wait. */
const AFTER_FOOD_AND_ARMS: StepHold = {
  kind: 'all',
  holds: [
    { kind: 'built', building: 'work_bakery_01' },
    { kind: 'built', building: 'work_brewery' },
    { kind: 'built', building: 'work_smithy_01' },
    { kind: 'built', building: 'work_joinery_01' },
  ],
};

/** The homes every seat's opening raises (owner ruling): a roomy or rich seat raises more on top. */
const OPENING_HOMES = 3;

/**
 * When the pottery and the mason hut go up a tier (owner ruling: the mill, the bakery, the homes, the
 * joinery, the animal farm, the well and the tailor come before them, since the tiles and marble only
 * those tiers make go into later buildings and an early upgrade takes the builders from the core). The
 * upgrade gives way only while one of those is ready to be placed and has no site yet, so it follows
 * right behind them rather than waiting for a building that takes tiles; a step of another line already
 * wanting tiles or marble, as the upper bakery once the baker has learned its candy, lets it go at once.
 * The pottery's tier unlocks only with the tile discovery, the mason hut's with the marble one.
 */
export const MATERIAL_TIERS_DUE: StepHold = {
  kind: 'any',
  holds: [
    {
      kind: 'noneDue',
      buildings: [
        'home_level_00',
        'work_mill_00',
        'work_well_00',
        'work_bakery_00',
        'work_joinery_00',
        'work_animal_farm',
        'work_sewery_00',
      ],
    },
    { kind: 'wanted', good: 'tile' },
    { kind: 'wanted', good: 'ornament' },
  ],
};

/** Druid huts on the big healing potion up to `count`, beside the ones standing, once the seat makes it. */
function druidHuts(count: number): BuildOrderEntry {
  return {
    kind: 'place',
    building: 'work_druid_01',
    count,
    near: [{ kind: 'building', id: 'work_druid_01' }],
    needsResources: ['mushroom', 'gold'],
    holdUntil: BIG_POTION,
  };
}

/** Mints up to `count`, by the gold. */
function mints(count: number): Extract<BuildOrderEntry, { kind: 'place' }> {
  return {
    kind: 'place',
    building: 'work_coin_mint',
    count,
    near: [{ kind: 'resource', good: 'gold' }],
    needsResources: ['gold'],
  };
}

/** The second and third mint; a seat with little gold keeps to the first (`./seat-order.ts`). */
export const LATER_MINTS: readonly BuildOrderEntry[] = [{ ...mints(2), holdUntil: AMULETS }, mints(3)];

/** The second to fourth upper smithy, plate and mail arming the army; a seat with little iron forges its
 *  weapons in two (`./seat-order.ts`). Owner ruling: on an iron-rich seat the army wears plate and mail, so
 *  all three come as soon as the smith learns them, one step not behind the crews of those standing, which
 *  never waits for one copy's site to finish before placing the next. */
export const LATE_SMITHIES: readonly BuildOrderEntry[] = [
  { kind: 'place', building: 'work_smithy_01', count: 4, near: IRON_AND_WOOD, aheadOfCrews: true },
];

/** Owner ruling: a seat with room opens on four or five lower-tier homes, so more of its couples have
 *  children from the start; a cramped seat keeps to the first three (`./seat-order.ts`). */
export const ROOMY_OPENING_HOMES: BuildOrderEntry = { kind: 'place', building: 'home_level_00', count: 4 };

/** Owner ruling: a rich seat (room, iron and gold to spare) opens on five homes, ends on six upper smithies
 *  and about four upper bakeries; every other archetype leaves these steps out (`./seat-order.ts`). */
const RICH_OPENING_HOMES: BuildOrderEntry = { kind: 'place', building: 'home_level_00', count: 5 };

const RICH_SMITHIES: readonly BuildOrderEntry[] = [
  { kind: 'place', building: 'work_smithy_01', count: 5, near: [{ kind: 'resource', good: 'iron' }] },
  { kind: 'place', building: 'work_smithy_01', count: 6, near: [{ kind: 'resource', good: 'iron' }] },
];

const RICH_BAKERIES: readonly BuildOrderEntry[] = [
  {
    kind: 'place',
    building: 'work_bakery_00',
    count: 3,
    near: [{ kind: 'building', id: 'work_mill_00' }],
    holdUntil: { kind: 'settlers', count: THIRD_BAKERY_FROM_SETTLERS },
  },
  // Counted after every other water drinker the order raises, the last druid well's 17 included.
  wellBeside('work_bakery_00', 18),
  { kind: 'upgrade', building: 'work_bakery_01', count: 3 },
  {
    kind: 'place',
    building: 'work_bakery_00',
    count: 4,
    near: [{ kind: 'building', id: 'work_mill_00' }],
    holdUntil: { kind: 'settlers', count: FOURTH_BAKERY_FROM_SETTLERS },
  },
  wellBeside('work_bakery_00', 19),
  { kind: 'upgrade', building: 'work_bakery_01', count: 4 },
];

export const RICH_STEPS: readonly BuildOrderEntry[] = [
  RICH_OPENING_HOMES,
  ...RICH_SMITHIES,
  ...RICH_BAKERIES,
];

/** Owner ruling: an iron-poor seat arms with tunics and wants many of them fast, so its two tailors are
 *  one step placed before the first tailor's, the second not waiting for the first one's site or crew; an
 *  iron-rich one sews leather and boots at one tailor until the upper tier stands (`./seat-order.ts`).
 *  Authored: as a step after the first tailor's, the second waited for that site to finish and then for a
 *  free site behind every line raising a building the seat lacked, to game minute 55-80 on krwawa_rzeka. */
export const EARLY_SECOND_TAILOR: BuildOrderEntry = {
  kind: 'place',
  building: 'work_sewery_00',
  count: 2,
  near: [
    { kind: 'building', id: 'work_sewery_00' },
    { kind: 'building', id: 'work_animal_farm' },
  ],
  aheadOfCrews: true,
  onlyWhen: 'livestock',
};

/** Owner ruling: a seat dressing its army in tunics runs two upper tailors, two of the four tailors on
 *  shoes and two on tunics (`workforce/craft.ts`), and upgrades both as soon as the sewer learns the wool
 *  armour: one step ahead of the single upgrade, so the second never waits for the first one's site. */
export const SECOND_UPPER_TAILOR: BuildOrderEntry = {
  kind: 'upgrade',
  building: 'work_sewery_01',
  count: 2,
  onlyWhen: 'livestock',
};

/** Owner ruling: a tunic seat raises its second animal farm, its breeders split as the first's, early and
 *  without waiting for the first one's crew: the tailors dressing the army want its leather and wool, and
 *  its meat feeds the opening. It is a step of the bread line, so the clothing line's tailors never wait
 *  behind it. */
export const SECOND_ANIMAL_FARM: BuildOrderEntry = {
  kind: 'place',
  building: 'work_animal_farm',
  count: 2,
  near: [
    { kind: 'building', id: 'work_animal_farm' },
    { kind: 'building', id: 'work_farm_00' },
  ],
  aheadOfCrews: true,
  onlyWhen: 'livestock',
};

/** A well beside the second animal farm when the first one's stands out of reach; its cap counts every
 *  water drinker the lines raise before the late druid huts. */
export const SECOND_ANIMAL_FARM_WELL: BuildOrderEntry = wellBeside('work_animal_farm', 12);

/** The grain farm. Every bakery, brewery and animal farm downstream waits on its grain, so each of their
 *  lines opens on it, met by whichever line raised it, and holds until it stands. Owner ruling: it takes a
 *  large free area, since the animal farm, the mill, two bakeries and a well follow beside it and a short
 *  chain helps a lot. */
const GRAIN_FARM: BuildOrderEntry = {
  kind: 'place',
  building: 'work_farm_00',
  count: 1,
  ground: 'plantable',
  essential: true,
  room: ['work_animal_farm', 'work_mill_00', 'work_bakery_00', 'work_bakery_00', 'work_well_00'],
};

/** Owner ruling: the iron gatherer who climbs the smithy tree starts in game minute 15-30, once the
 *  opening's clay and stone gatherers have earned the potter and the mason. */
export const IRON_CLIMB_FROM_TICKS = minutesToTicks(15);

/** Owner ruling: the mushroom gatherer who opens the herb hut starts in game minute 25-40. */
export const MUSHROOMS_FROM_TICKS = minutesToTicks(25);

/** The clay the seat stores before its clay gatherer goes back to the builders (authored): over the mud's
 *  mid-game glut line (`../../workforce/supply.ts`, 26 units on the default order); on
 *  battle_for_the_four_hills_multiplayer the one clay gatherer piled 45-90 clay by game minute 60 while
 *  2-3 builders served 4-7 open sites. */
const CLAY_STOCKED = 30;

/** The mushrooms the seat stores before its gatherers stop (owner ruling: they piled up to 199-306 by game
 *  minute 110 on magiczny_las): every druid shelf the healing line raises full, six huts of ten. */
const MUSHROOMS_STOCKED = 60;

/** The gold gatherer who earns the coiner starts with the iron climb (authored): the mint's bill waits on
 *  the tile and marble tiers anyway, which stand around then on magiczny_las. */
export const GOLD_FROM_TICKS = IRON_CLIMB_FROM_TICKS;

/**
 * Authored: the build order is a plan, not extracted data. A placement charges the merged bill of its
 * whole tier chain, so the executor holds a line's step until every good of that bill is gathered, made
 * by a building the seat owns, or in store; within a line, the steps keep the order the materials and
 * the workshops they feed come in. Its `_01` workshop steps build straight to that tier because the
 * extracted `jobEnablesHouse` rows enable each tier as a separately placeable house type. The weapon shops have a line of their own rather than a place in
 * a late tail, since the garrison rung publishes only the classes it can arm right now.
 */
export const DEFAULT_BUILD_ORDER: BuildOrder = {
  lines: [
    {
      id: 'opening',
      steps: [
        // Owner ruling: a seat opens on one wood, one clay and one stone gatherer, the opening hunter and
        // the farmer beside them. The clay and stone gatherers earn the potter and the mason.
        { kind: 'collector', good: 'wood' },
        { kind: 'collector', good: 'mud', stockedAt: CLAY_STOCKED },
        { kind: 'collector', good: 'stone' },
        GRAIN_FARM,
        // Owner ruling: farm, then potter and mason, then mill, then bakery, then the rest. The pottery and
        // the mason hut go up the moment they unlock, ahead of the mill: the school's bill takes the
        // potter's bricks and the mason's pillars, and every later bill waits on them. While locked they
        // are passed over, so the opening homes rise meanwhile.
        {
          kind: 'place',
          building: 'work_pottery_00',
          count: 1,
          near: [{ kind: 'resource', good: 'mud' }],
          atUnlock: true,
          lockPasses: true,
        },
        { ...MASON_HUT, atUnlock: true, lockPasses: true },
        { kind: 'place', building: 'home_level_00', count: OPENING_HOMES },
        ROOMY_OPENING_HOMES,
        RICH_OPENING_HOMES,
        // Owner ruling: the school once the pottery stands, never before it, a core building, so every
        // trade discovered from here on is taught there rather than earned again by work. It has no
        // production ties, so it stands among the homes and leaves the farm's ground to its chain.
        {
          kind: 'place',
          building: 'school',
          count: 1,
          holdUntil: { kind: 'built', building: 'work_pottery_00' },
          amongHomes: true,
          core: true,
        },
        // Owner ruling: a second stone gatherer within the first 10-15 game minutes, since the roads and
        // the mason eat the most stone.
        { kind: 'collector', good: 'stone', count: 2 },
        // Owner ruling: the homes grow with the women, since their family slots bound the daughters. The
        // lane opens behind the pottery, school and mason, so the first upgrades find bricks and pillars,
        // and earlier on a food-rich seat (`../steps/housing.ts`).
        { kind: 'housing', building: 'home_level_00', count: HOUSING_HOMES_CAP },
      ],
    },
    {
      id: 'bread',
      steps: [
        GRAIN_FARM,
        // Owner ruling: the mill, and then the bakery, goes up the moment it unlocks, on every map.
        {
          kind: 'place',
          building: 'work_mill_00',
          count: 1,
          near: [{ kind: 'building', id: 'work_farm_00' }],
          atUnlock: true,
        },
        // The bakery's bill takes a pillar, so a mason hut the opening has not raised yet goes up with the
        // mill, ahead of the well, and its mason has the pillar made by the time the bakery's site opens.
        // It unlocks with the mason's trade, which the bakery's unlock also asks, and is passed over while
        // that is locked.
        { ...MASON_HUT, atUnlock: true, lockPasses: true },
        // Owner ruling: bread is the food the seat runs short of first, and little food means few children,
        // so one bakery follows the mill at once. Its well goes up first, beside the mill, while the baker
        // is still being earned, so it stands when the bakery does; a mill with a well in reach, or with no
        // room for one, passes it over. The cap counts a far well the seat may already own.
        { ...wellBeside('work_mill_00', OPENING_WELLS_CAP), atUnlock: true },
        {
          kind: 'place',
          building: 'work_bakery_00',
          count: 1,
          near: [
            { kind: 'building', id: 'work_mill_00' },
            { kind: 'building', id: 'work_well_00' },
          ],
          atUnlock: true,
        },
        // A seat dressing its army in tunics only (`./seat-order.ts`).
        SECOND_ANIMAL_FARM,
        SECOND_ANIMAL_FARM_WELL,
        // Owner ruling: a second bakery where the seat has room; a cramped seat caps this at one
        // (`./seat-order.ts`). It waits for the first one's baker like every copy (`../steps/holds.ts`).
        {
          kind: 'place',
          building: 'work_bakery_00',
          count: 2,
          near: [{ kind: 'building', id: 'work_mill_00' }],
        },
        // Every bakery drinks water like the brewery: one standing beyond a well's reach gets a well
        // beside it.
        wellBeside('work_bakery_00', 7),
        // Owner ruling: the adults live on mead and the bread feeds the children, so one upper-tier bakery
        // supplies a large village; the seat upgrades the bakeries it has and fills their crews before it
        // raises a third, and only a rich seat raises one.
        { kind: 'upgrade', building: 'work_bakery_01', count: 1 },
        { kind: 'upgrade', building: 'work_bakery_01', count: 2 },
        ...RICH_BAKERIES,
      ],
    },
    {
      id: 'homes',
      steps: [
        // From the late game the warehouses run as a lane, one site out of the four the late game opens
        // (authored): a warehouse wherever a workshop or a work flag stands beyond every store's reach, so
        // the smithies unload nearby and the ore piled at the mines gets carried in.
        {
          kind: 'storeCoverage',
          building: 'stock_02',
          radius: STORE_COVERAGE_RADIUS_NODES,
          lane: true,
          fromTick: LATE_GAME_FROM_TICKS,
        },
      ],
    },
    {
      id: 'materials',
      // Tiles and marble come only from these tiers, and homes, the armory, the upper bakeries and druids and
      // the mint all wait on them.
      steps: [
        { kind: 'upgrade', building: 'work_pottery_01', count: 1, holdUntil: MATERIAL_TIERS_DUE },
        { kind: 'upgrade', building: 'work_mason_hut_01', count: 1, holdUntil: MATERIAL_TIERS_DUE },
      ],
    },
    {
      id: 'brewery',
      steps: [
        GRAIN_FARM,
        // Owner ruling: the first brewery, with its hive and well, ranks with the bakery and goes up the
        // moment the baker's work unlocks it, since mead speeds the whole economy. It comes first and fixes
        // where its honey and water come from: the hive beside it, unlocked with it and raised while its
        // site still rises, since the brewery brews nothing without honey, and a second well beside it too
        // when the first one stands farther off.
        {
          kind: 'place',
          building: 'work_brewery',
          count: 1,
          near: [{ kind: 'building', id: 'work_well_00' }],
          firstRank: true,
        },
        {
          kind: 'place',
          building: 'work_hive_00',
          count: 1,
          near: [{ kind: 'building', id: 'work_brewery' }],
          firstRank: true,
        },
        { ...wellBeside('work_brewery', 2), firstRank: true },
        // Beside the first, sharing its hive and well when they stand in reach; a second hive and well beside
        // it otherwise. The third, the last, beside the first two by the same rule.
        ...breweryWithHiveAndWell(2, 8, SECOND_BREWERY_FROM_SETTLERS),
        // A seat short of grass puts its herb hut on the grass it keeps, ahead of the healing line, after
        // which its other buildings may take the rest; a green seat raises it with the druids of that line.
        // After the second brewery, so its special-path hold never keeps that brewery waiting.
        {
          kind: 'place',
          building: 'work_herb_hut',
          count: 1,
          near: [{ kind: 'building', id: 'work_well_00' }],
          ground: 'plantable',
          needsResources: ['mushroom', 'gold'],
          onlyWhen: 'grassScarce',
          holdUntil: AFTER_FOOD_AND_ARMS,
        },
        ...breweryWithHiveAndWell(3, 11, THIRD_BREWERY_FROM_SETTLERS),
      ],
    },
    {
      id: 'clothing',
      steps: [
        GRAIN_FARM,
        // Owner ruling: the animal farm and the tailors wait while the seat owns no pair of sheep or cattle.
        {
          kind: 'place',
          building: 'work_animal_farm',
          count: 1,
          near: [
            { kind: 'building', id: 'work_farm_00' },
            { kind: 'building', id: 'work_well_00' },
          ],
          onlyWhen: 'livestock',
        },
        // The animal farm drinks water like the brewery, so it gets a well beside it when none stands in
        // reach.
        wellBeside('work_animal_farm', 3),
        // The upper tier wants wool armour, which only a sewer working the lower tier learns to make. A seat
        // dressing its army in tunics only raises and upgrades both its tailors first (`./seat-order.ts`).
        EARLY_SECOND_TAILOR,
        {
          kind: 'place',
          building: 'work_sewery_00',
          count: 1,
          near: [{ kind: 'building', id: 'work_animal_farm' }],
          onlyWhen: 'livestock',
        },
        SECOND_UPPER_TAILOR,
        { kind: 'upgrade', building: 'work_sewery_01', count: 1, onlyWhen: 'livestock' },
        // The second tailor, counted with the upgraded one, so this adds one building: the upper tier
        // outright once the seat sources it (`../supply/direct-tier.ts`), else the small tailor as a shoemaker.
        {
          kind: 'place',
          building: 'work_sewery_00',
          count: 2,
          near: [{ kind: 'building', id: 'work_sewery_01' }],
          onlyWhen: 'livestock',
        },
      ],
    },
    {
      id: 'tools',
      // The joinery works iron tools out of wood and iron: it stands between its two deposits, so its
      // carrier never walks far. The top-tier joineries of the military line work ships and catapults
      // first, so they neither meet this line's steps nor its upgrade, but on a seat with no room to grow
      // (`./seat-order.ts`).
      steps: [
        // The lower tier first: the furniture its upper tier wants is learned at it.
        {
          kind: 'place',
          building: 'work_joinery_00',
          count: 1,
          near: WOOD_AND_IRON,
          belowTier: 'work_joinery_03',
        },
        { kind: 'upgrade', building: 'work_joinery_01', count: 1, belowTier: 'work_joinery_03' },
        // Soon after, a tier up for the carriers' handcarts (`workforce/craft.ts`).
        { kind: 'upgrade', building: 'work_joinery_02', count: 1, belowTier: 'work_joinery_03' },
      ],
    },
    {
      id: 'weapons',
      // The smithy works its wares out of iron and wood, so it stands between the two deposits.
      // Its lower tier first: mail and plate, which its upper tier wants, are learned there.
      steps: [
        // Owner ruling: from game minute 15-30 an iron gatherer climbs the smithy tree, his iron making him
        // the first smith; the joinery's iron tools and the smithies take his ore.
        { kind: 'collector', good: 'iron', fromTick: IRON_CLIMB_FROM_TICKS },
        { kind: 'place', building: 'work_smithy_00', count: 1, near: IRON_AND_WOOD },
        { kind: 'upgrade', building: 'work_smithy_01', count: 1 },
        // Owner ruling: on a seat with iron the upper smithies' mail and plate arm the army, so once the
        // smith has learned them (the upper tier is enabled by that discovery) more upper smithies follow,
        // up to four, six on a rich seat; a seat with little iron stops at two, and one without iron in
        // reach raises none (`./seat-order.ts`). Up to the fourth they go up at once, the rich seat's fifth
        // and sixth each wait for the crews of those standing (`../steps/holds.ts`).
        ...LATE_SMITHIES,
        { kind: 'place', building: 'work_smithy_01', count: 2, near: IRON_AND_WOOD, aheadOfCrews: true },
        ...RICH_SMITHIES,
      ],
    },
    {
      id: 'armory',
      // Owner ruling: the armourer's workshop right after the first smithy, not behind the smithy's upgrade.
      // It turns wood into bows and spear shafts, so it stands by the wood like the joinery; its lower tier
      // first, where the long bow its upper tier wants is learned. A seat without iron raises no smithy,
      // which lets its armory go up at once.
      steps: [
        {
          kind: 'place',
          building: 'work_armory_00',
          count: 1,
          near: [{ kind: 'resource', good: 'wood' }],
          holdUntil: { kind: 'built', building: 'work_smithy_00' },
        },
        { kind: 'upgrade', building: 'work_armory_01', count: 1 },
        // The late late game runs out of long bows.
        {
          kind: 'place',
          building: 'work_armory_01',
          count: 2,
          near: [{ kind: 'resource', good: 'wood' }],
          holdUntil: { kind: 'settlers', count: SECOND_ARMORY_FROM_SETTLERS },
        },
      ],
    },
    MILITARY_LINE,
    {
      id: 'healing',
      // The big potion takes herbs, mushrooms and coins, and the temple waits on the druids' oil, so all of
      // it stands only where the map holds both gold and mushrooms.
      // Owner ruling: a mushroom gatherer from game minute 25-40, whose ten mushrooms open the herb hut; not
      // before, nor before the food and arms, and only the one until potions are made in volume.
      steps: [
        {
          kind: 'collector',
          good: 'mushroom',
          fromTick: MUSHROOMS_FROM_TICKS,
          holdUntil: AFTER_FOOD_AND_ARMS,
          stockedAt: MUSHROOMS_STOCKED,
        },
        // The herb hut comes first, beside a well, so its herbs are growing when the druids it draws beside
        // it stand.
        {
          kind: 'place',
          building: 'work_herb_hut',
          count: 1,
          near: [{ kind: 'building', id: 'work_well_00' }],
          ground: 'plantable',
          needsResources: ['mushroom', 'gold'],
          holdUntil: AFTER_FOOD_AND_ARMS,
        },
        // The lower tier first: the small food potion its upper tier wants is learned there.
        {
          kind: 'place',
          building: 'work_druid_00',
          count: 1,
          near: [{ kind: 'building', id: 'work_herb_hut' }],
          needsResources: ['mushroom', 'gold'],
        },
        { kind: 'upgrade', building: 'work_druid_01', count: 1 },
        // The druids brew with water: each druid step is followed by a well beside the hut with none in
        // reach.
        wellBeside('work_druid_01', 5),
        // Beside the barracks: the temple stands with the army it blesses, not on a front of its own.
        {
          kind: 'place',
          building: 'work_temple',
          count: 1,
          near: [{ kind: 'building', id: 'barracks' }],
          needsResources: ['mushroom', 'gold'],
        },
        // Owner ruling: one druid until he has learned the big healing potion; the huts after him make only
        // big potions, with a second mushroom gatherer to feed them once they stand.
        druidHuts(2),
        { kind: 'collector', good: 'mushroom', count: 2, stockedAt: MUSHROOMS_STOCKED },
        wellBeside('work_druid_01', 10),
        druidHuts(4),
        wellBeside('work_druid_01', 13),
        druidHuts(6),
        wellBeside('work_druid_01', 17),
      ],
    },
    {
      id: 'coins',
      // Owner ruling: one mint early enough to earn experience, since the coiner learns the amulets the
      // big potion also wants and the druids pay in coins; never two at once as the first. Once he has
      // learned the amulets, the late game's move into high-end equipment, two more follow, each waiting
      // for the crews of those standing (`../steps/holds.ts`). The gold gatherer and the first mint wait for the
      // food and arms like the herb hut.
      steps: [
        { kind: 'collector', good: 'gold', fromTick: GOLD_FROM_TICKS, holdUntil: AFTER_FOOD_AND_ARMS },
        { ...mints(1), holdUntil: AFTER_FOOD_AND_ARMS },
        ...LATER_MINTS,
      ],
    },
  ],
  // Owner ruling: the economy first. The opening, so the farm, the first homes and the material workshops
  // take the first sites; then bread and drink, the tools (the handcarts matter a great deal), clothing
  // (boots speed every trade up; a seat dressing its army in tunics raises it ahead of the tools,
  // `./seat-order.ts`) and the first smithy steps, and only then the tile and marble tiers, which are needed a bit later; the army
  // the garrison waits on, the mint, the herb hut and druids, whose first steps also wait for the food and
  // arms to stand ({@link AFTER_FOOD_AND_ARMS}). The homes line holds only lanes.
  priority: [
    'opening',
    'bread',
    'brewery',
    'tools',
    'clothing',
    'weapons',
    'armory',
    'materials',
    'military',
    'coins',
    'healing',
    'homes',
  ],
};
