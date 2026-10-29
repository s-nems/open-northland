import { TICKS_PER_SECOND } from '../../../core/loop.js';
import type { ComputerProfile } from '../difficulty.js';
import { LATE_GAME_FROM_TICKS, minutesToTicks, SITES_GROW_FROM_TICKS } from '../game-phase.js';
import type { JoineryRole } from '../joinery-role.js';

/** Where a placement gravitates, on top of the always-on near-base rule; `placement.ts` resolves
 *  each kind to a node. `resource` is the good's nearest live deposit, or the seat's store holding the
 *  most of the good once none stands. `front` is the settlement's own edge toward the nearest enemy seat,
 *  its headquarters before any other building, and toward the map centre while no enemy has a building
 *  standing. `shore` is the nearest water beside the seat's land a ship can sail, a body that also
 *  touches the enemy's continent first; unlike the others it is a hard rule, the spot landing close
 *  enough to that water for the workshop's ship yard. */
export type PlacementAffinity =
  | { readonly kind: 'building'; readonly id: string }
  | { readonly kind: 'resource'; readonly good: string }
  | { readonly kind: 'mapCentre' }
  | { readonly kind: 'front' }
  | { readonly kind: 'shore' };

/** What a placement waits for while its line holds on it: a built building of the id (at that tier or
 *  above, a rising site not counting), or a good the seat has discovered how to make. A hold the seat can
 *  never meet, a building or good missing from the content or a discovery it can never make, lets the
 *  step act (`./progress.ts`). */
export type StepHold =
  | { readonly kind: 'built'; readonly building: string }
  | { readonly kind: 'good'; readonly good: string };

export type BuildOrderEntry =
  /** Place `count` buildings of the stable content id. `near` pulls the spot toward its anchors,
   *  `ground: 'plantable'` puts the footprint on sowable ground, or where none fits, beside free sowable
   *  ground (`placement.ts`). `needsResources`
   *  names the map goods the building exists to work up; an unmet entry is skipped while the map holds
   *  none of any one of them, like a collector entry. `unlessWithin` skips the entry while every one of
   *  the seat's named buildings (at that tier or above) has one of the buildings the entry counts within
   *  `radius` world-metric nodes, or while the seat has none of those; a `near` affinity on the same id
   *  then pulls the spot toward the first one lacking. `onlyWhen: 'rivalOverSea'` skips the entry while
   *  the headquarters the seat sails for (`../sea-route.ts`) can be reached by land, `'grassScarce'` while
   *  the seat has grass enough (`./grass-reserve.ts`). An entry of a grass building with no grass left
   *  for it is passed over unless `essential`, which holds its line until it stands. `belowTier` stops the
   *  count below that tier of the chain, so buildings placed straight at it never meet the entry. `role` counts only the top-tier
   *  joineries holding that role (`../joinery-role.ts`). `holdUntil` holds the line on the unmet entry,
   *  acting on nothing, until its {@link StepHold} is met. */
  | {
      readonly kind: 'place';
      readonly building: string;
      readonly count: number;
      readonly near?: readonly PlacementAffinity[];
      readonly ground?: 'plantable';
      readonly needsResources?: readonly string[];
      readonly unlessWithin?: { readonly building: string; readonly radius: number };
      readonly onlyWhen?: 'rivalOverSea' | 'grassScarce';
      readonly essential?: true;
      readonly belowTier?: string;
      readonly role?: JoineryRole;
      readonly holdUntil?: StepHold;
    }
  /** Upgrade owned buildings up their `upgradeTarget` chain until `count` stand at or above the
   *  named tier, and below `belowTier` when given. */
  | {
      readonly kind: 'upgrade';
      readonly building: string;
      readonly count: number;
      readonly belowTier?: string;
    }
  /** Wait for `count` (default 1) flag-bound gatherers of the good; the workforce module owns the hire
   *  and keeps at least that many. Posts past the first come out of spare men only, so its line holds
   *  here until the seat has them. A good with no live resource is skipped. `fromTick` holds the line
   *  here, hiring nobody, until the game clock reaches it. */
  | {
      readonly kind: 'collector';
      readonly good: string;
      readonly count?: number;
      readonly fromTick?: number;
    }
  /** Keep every owned building inside some tower's or the base's defence circle of `radius` nodes
   *  (default {@link TOWER_DEFENCE_RADIUS_NODES}). Unlike the counted entries it re-arms whenever a later
   *  building lands uncovered, so the tower count is dynamic. A `lane` entry runs beside the lines once
   *  every counted step before it in its line stands met: it holds one site of its building at a time,
   *  taken out of the clock's site count, never stalls the steps behind it, and they never wait on it. */
  | {
      readonly kind: 'towerCoverage';
      readonly building: string;
      readonly radius?: number;
      readonly lane?: true;
    }
  /** The same rule over the seat's stores: every owned building within `radius` nodes of the base or a
   *  warehouse, so goods never travel far to a store. */
  | {
      readonly kind: 'storeCoverage';
      readonly building: string;
      readonly radius: number;
      readonly lane?: true;
    };

/** Whether `entry` is a lane running beside the lines rather than a step of its line. */
export function isLaneEntry(entry: BuildOrderEntry): boolean {
  return (entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') && entry.lane === true;
}

/** The late tail's denser tower ring, in world-metric nodes (authored): tighter than the opening
 *  {@link TOWER_DEFENCE_RADIUS_NODES}, so the finished settlement stands under overlapping towers. */
const DENSE_TOWER_RADIUS_NODES = 14;

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
function wellBeside(building: string, cap: number): BuildOrderEntry {
  return {
    kind: 'place',
    building: 'work_well_00',
    count: cap,
    near: [{ kind: 'building', id: building }],
    unlessWithin: { building, radius: WELL_REACH_NODES },
  };
}

/** The `count`th brewery beside the others, then a hive and a well beside it unless theirs stand in reach. */
function breweryWithHiveAndWell(count: number, wellCap: number): BuildOrderEntry[] {
  return [
    { kind: 'place', building: 'work_brewery', count, near: [{ kind: 'building', id: 'work_brewery' }] },
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

/** Owner ruling: the herb hut never goes up before the seat's first bakery stands. */
const AFTER_FIRST_BAKERY: StepHold = { kind: 'built', building: 'work_bakery_00' };

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

/** Owner ruling: an iron-poor seat arms with tunics and gets its second tailor right after the first; an
 *  iron-rich one sews leather and boots at one tailor until the upper tier stands (`./seat-order.ts`). */
export const EARLY_SECOND_TAILOR: BuildOrderEntry = {
  kind: 'place',
  building: 'work_sewery_00',
  count: 2,
  near: [{ kind: 'building', id: 'work_sewery_00' }],
};

/** The grain farm. Every bakery, brewery and animal farm downstream waits on its grain, so each of their
 *  lines opens on it, met by whichever line raised it, and holds until it stands. */
const GRAIN_FARM: BuildOrderEntry = {
  kind: 'place',
  building: 'work_farm_00',
  count: 1,
  ground: 'plantable',
  essential: true,
};

/** Owner ruling: the iron gatherer who climbs the smithy tree starts in game minute 15-30, once the
 *  opening's clay and stone gatherers have earned the potter and the mason. */
export const IRON_CLIMB_FROM_TICKS = minutesToTicks(15);

/** Owner ruling: the mushroom gatherer who opens the herb hut starts in game minute 25-40. */
export const MUSHROOMS_FROM_TICKS = minutesToTicks(25);

/** The gold gatherer who earns the coiner starts with the iron climb (authored): the mint's bill waits on
 *  the tile and marble tiers anyway, which stand around then on magiczny_las. */
export const GOLD_FROM_TICKS = IRON_CLIMB_FROM_TICKS;

/** The build order's independent lines (authored). Each is an ordered list of steps: a step waits for the
 *  step before it in its line, never for another line. */
export type BuildLineId =
  | 'opening'
  | 'homes'
  | 'materials'
  | 'bread'
  | 'brewery'
  | 'clothing'
  | 'tools'
  | 'weapons'
  | 'military'
  | 'healing'
  | 'coins';

export interface BuildLine {
  readonly id: BuildLineId;
  readonly steps: readonly BuildOrderEntry[];
}

/** A seat's build order: its lines, and the priority in which a free construction site goes to their
 *  ready steps, first id first; a line the priority leaves out comes after, in declaration order. */
export interface BuildOrder {
  readonly lines: readonly BuildLine[];
  readonly priority: readonly BuildLineId[];
}

/** A step's stable identity in saved and per-decision state: its line and its index in that line. */
export type StepKey = `${BuildLineId}:${number}`;

export function stepKey(line: BuildLineId, step: number): StepKey {
  return `${line}:${step}`;
}

const sortedLines = new WeakMap<BuildOrder, readonly BuildLine[]>();

/** `order`'s lines in its priority order. */
export function linesByPriority(order: BuildOrder): readonly BuildLine[] {
  const known = sortedLines.get(order);
  if (known !== undefined) return known;
  const rank = (line: BuildLine): number => {
    const at = order.priority.indexOf(line.id);
    return at < 0 ? order.priority.length : at;
  };
  const sorted = [...order.lines].sort((a, b) => rank(a) - rank(b));
  sortedLines.set(order, sorted);
  return sorted;
}

const flatSteps = new WeakMap<BuildOrder, readonly BuildOrderEntry[]>();

/** Every step of `order`, line after line, for the readers that only ask what the order holds. */
export function orderSteps(order: BuildOrder): readonly BuildOrderEntry[] {
  const known = flatSteps.get(order);
  if (known !== undefined) return known;
  const steps = order.lines.flatMap((line) => line.steps);
  flatSteps.set(order, steps);
  return steps;
}

/**
 * Authored: the build order is a plan, not extracted data. A placement charges the merged bill of its
 * whole tier chain, so the executor holds a line's step until every good of that bill is gathered, made
 * by a building the seat owns, or in store; within a line, the steps keep the order the materials and
 * the workshops they feed come in. Its `_01` workshop and `home_level_04` steps build straight to that
 * tier because the extracted `jobEnablesHouse` rows enable each tier as a separately placeable house type
 * charging its own non-cumulative bill. The weapon shops have a line of their own rather than a place in
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
        { kind: 'collector', good: 'mud' },
        { kind: 'collector', good: 'stone' },
        GRAIN_FARM,
        { kind: 'place', building: 'home_level_00', count: 3 },
        { kind: 'place', building: 'work_pottery_00', count: 1, near: [{ kind: 'resource', good: 'mud' }] },
        // Owner ruling: the school right after the pottery, a core building, so every trade discovered
        // from here on is taught there rather than earned again by work.
        { kind: 'place', building: 'school', count: 1 },
        {
          kind: 'place',
          building: 'work_mason_hut_00',
          count: 1,
          near: [{ kind: 'resource', good: 'stone' }],
        },
        // Owner ruling: a second stone gatherer within the first 10-15 game minutes, since the roads and
        // the mason eat the most stone.
        { kind: 'collector', good: 'stone', count: 2 },
        { kind: 'upgrade', building: 'home_level_02', count: 3 },
      ],
    },
    {
      id: 'bread',
      steps: [
        GRAIN_FARM,
        {
          kind: 'place',
          building: 'work_mill_00',
          count: 1,
          near: [{ kind: 'building', id: 'work_farm_00' }],
        },
        // Owner ruling: bread is the food the seat runs short of first, and little food means few children,
        // so one bakery follows the mill at once and its well right after.
        {
          kind: 'place',
          building: 'work_bakery_00',
          count: 1,
          near: [{ kind: 'building', id: 'work_mill_00' }],
        },
        {
          kind: 'place',
          building: 'work_well_00',
          count: 1,
          near: [
            { kind: 'building', id: 'work_mill_00' },
            { kind: 'building', id: 'work_bakery_00' },
          ],
        },
        // Owner ruling: a second bakery at once where the seat has room; a cramped seat caps this at one
        // (`./seat-order.ts`), so its next bakery waits for the upper tier.
        {
          kind: 'place',
          building: 'work_bakery_00',
          count: 2,
          near: [{ kind: 'building', id: 'work_mill_00' }],
        },
        { kind: 'upgrade', building: 'work_bakery_01', count: 1 },
        {
          kind: 'place',
          building: 'work_bakery_01',
          count: 3,
          near: [{ kind: 'building', id: 'work_mill_00' }],
        },
        // Every bakery drinks water like the brewery: one standing beyond a well's reach gets a well
        // beside it.
        wellBeside('work_bakery_00', 7),
        {
          kind: 'place',
          building: 'work_bakery_01',
          count: 4,
          near: [{ kind: 'building', id: 'work_mill_00' }],
        },
        wellBeside('work_bakery_00', 14),
      ],
    },
    {
      id: 'homes',
      // The opening's homes, raised further once tiles and marble come in; the line runs behind the
      // workshops, which its upgrades would otherwise draw the tiles and marble from.
      steps: [
        { kind: 'upgrade', building: 'home_level_03', count: 3 },
        { kind: 'upgrade', building: 'home_level_04', count: 3 },
        { kind: 'place', building: 'home_level_04', count: 5 },
        { kind: 'place', building: 'home_level_04', count: 8 },
        // From here the warehouses and the denser tower ring run as lanes beside the lines, one site each out
        // of the four the late game opens (authored): a warehouse wherever a workshop or a work flag stands
        // beyond every store's reach, so the smithies unload nearby and the ore piled at the mines gets
        // carried in; a tower wherever the ring leaves a building out. A filled settlement with no room for
        // a tower holds the lane, not the line.
        { kind: 'storeCoverage', building: 'stock_02', radius: STORE_COVERAGE_RADIUS_NODES, lane: true },
        { kind: 'towerCoverage', building: 'tower_01', radius: DENSE_TOWER_RADIUS_NODES, lane: true },
        { kind: 'place', building: 'home_level_04', count: 12 },
      ],
    },
    {
      id: 'materials',
      // Tiles and marble come only from these tiers, and homes, the armory, the upper bakeries and druids and
      // the mint all wait on them.
      steps: [
        { kind: 'upgrade', building: 'work_pottery_01', count: 1 },
        { kind: 'upgrade', building: 'work_mason_hut_01', count: 1 },
      ],
    },
    {
      id: 'brewery',
      steps: [
        GRAIN_FARM,
        // The brewery comes first and fixes where its honey and water come from: the hive beside it, and a
        // second well beside it too when the first one stands farther off.
        {
          kind: 'place',
          building: 'work_brewery',
          count: 1,
          near: [{ kind: 'building', id: 'work_well_00' }],
        },
        {
          kind: 'place',
          building: 'work_hive_00',
          count: 1,
          near: [{ kind: 'building', id: 'work_brewery' }],
        },
        wellBeside('work_brewery', 2),
        // A seat short of grass puts its herb hut on the grass it keeps now, after which its other buildings
        // may take the rest; a green seat raises it with the druids of the healing line.
        {
          kind: 'place',
          building: 'work_herb_hut',
          count: 1,
          near: [{ kind: 'building', id: 'work_well_00' }],
          ground: 'plantable',
          needsResources: ['mushroom', 'gold'],
          onlyWhen: 'grassScarce',
          holdUntil: AFTER_FIRST_BAKERY,
        },
        // Beside the first, sharing its hive and well when they stand in reach; a second hive and well beside
        // it otherwise.
        ...breweryWithHiveAndWell(2, 8),
        // The third brewery beside the first two, with its own hive and well by the same rule.
        ...breweryWithHiveAndWell(3, 11),
        ...breweryWithHiveAndWell(4, 15),
      ],
    },
    {
      id: 'clothing',
      steps: [
        GRAIN_FARM,
        {
          kind: 'place',
          building: 'work_animal_farm',
          count: 1,
          near: [
            { kind: 'building', id: 'work_farm_00' },
            { kind: 'building', id: 'work_well_00' },
          ],
        },
        // The animal farm drinks water like the brewery, so it gets a well beside it when none stands in
        // reach.
        wellBeside('work_animal_farm', 3),
        // The upper tier wants wool armour, which only a sewer working the lower tier learns to make.
        {
          kind: 'place',
          building: 'work_sewery_00',
          count: 1,
          near: [{ kind: 'building', id: 'work_animal_farm' }],
        },
        EARLY_SECOND_TAILOR,
        { kind: 'upgrade', building: 'work_sewery_01', count: 1 },
        // The small tailor, a second shoemaker: counted with the upgraded one, so this adds one building.
        {
          kind: 'place',
          building: 'work_sewery_00',
          count: 2,
          near: [{ kind: 'building', id: 'work_sewery_01' }],
        },
      ],
    },
    {
      id: 'tools',
      // The joinery works iron tools out of wood and iron: it stands between its two deposits, so its
      // carrier never walks far. The top-tier joineries of the military line work ships and catapults,
      // never tools, so they neither meet this line's steps nor its upgrade.
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
      // Each shop's lower tier first: mail and the long bow, which their upper tiers want, are learned there.
      steps: [
        // Owner ruling: from game minute 15-30 an iron gatherer climbs the smithy tree, his iron making him
        // the first smith; the joinery's iron tools and the smithies take his ore.
        { kind: 'collector', good: 'iron', fromTick: IRON_CLIMB_FROM_TICKS },
        { kind: 'place', building: 'work_smithy_00', count: 1, near: IRON_AND_WOOD },
        { kind: 'upgrade', building: 'work_smithy_01', count: 1 },
        // The armourer turns wood into bows and spear shafts, so it stands by the wood like the joinery.
        { kind: 'place', building: 'work_armory_00', count: 1, near: [{ kind: 'resource', good: 'wood' }] },
        { kind: 'upgrade', building: 'work_armory_01', count: 1 },
        { kind: 'place', building: 'work_smithy_01', count: 2, near: IRON_AND_WOOD },
        { kind: 'place', building: 'work_smithy_01', count: 4, near: IRON_AND_WOOD },
        // The late game runs out of mail, plate and long bows.
        { kind: 'place', building: 'work_smithy_01', count: 5, near: [{ kind: 'resource', good: 'iron' }] },
        { kind: 'place', building: 'work_armory_01', count: 2, near: [{ kind: 'resource', good: 'wood' }] },
        { kind: 'place', building: 'work_smithy_01', count: 7, near: IRON_AND_WOOD },
      ],
    },
    {
      id: 'military',
      steps: [
        // On the settlement's edge toward the nearest enemy, where the attacks come from; the barracks also
        // holds the line in defence.
        { kind: 'place', building: 'barracks', count: 1, near: [{ kind: 'front' }] },
        // Where only a ship reaches the nearest rival, the joinery that builds it goes up by the water early.
        {
          kind: 'place',
          building: 'work_joinery_03',
          count: 1,
          near: [{ kind: 'shore' }],
          onlyWhen: 'rivalOverSea',
          role: 'ship',
        },
        { kind: 'towerCoverage', building: 'tower_01' },
        // The catapult joinery stands by the barracks, where the army musters. A land map gets one top-tier
        // joinery, a sea map two.
        {
          kind: 'place',
          building: 'work_joinery_03',
          count: 1,
          near: [{ kind: 'building', id: 'barracks' }],
          role: 'catapult',
        },
      ],
    },
    {
      id: 'healing',
      // The big potion takes herbs, mushrooms and coins, and the temple waits on the druids' oil, so all of
      // it stands only where the map holds both gold and mushrooms.
      // Owner ruling: a mushroom gatherer from game minute 25-40, whose ten mushrooms open the herb hut; not
      // before, and only the one until potions are made in volume.
      steps: [
        { kind: 'collector', good: 'mushroom', fromTick: MUSHROOMS_FROM_TICKS },
        // The herb hut comes first, beside a well, so its herbs are growing when the druids it draws beside
        // it stand.
        {
          kind: 'place',
          building: 'work_herb_hut',
          count: 1,
          near: [{ kind: 'building', id: 'work_well_00' }],
          ground: 'plantable',
          needsResources: ['mushroom', 'gold'],
          holdUntil: AFTER_FIRST_BAKERY,
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
        // big potions, with a second mushroom gatherer to feed them.
        { kind: 'collector', good: 'mushroom', count: 2 },
        druidHuts(2),
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
      // big potion also wants and the druids pay in coins; never two at once as the first. More come once
      // the upper druid stands, the third, for the strength amulets, once the big potion is made.
      steps: [
        { kind: 'collector', good: 'gold', fromTick: GOLD_FROM_TICKS },
        mints(1),
        { ...mints(2), holdUntil: { kind: 'built', building: 'work_druid_01' } },
        { ...mints(3), holdUntil: BIG_POTION },
      ],
    },
  ],
  // Owner ruling: the economy first. The opening, so the farm, the first homes and the material workshops
  // take the first sites; then bread and drink, clothing (boots speed every trade up), the tools and the
  // first smithy steps, and only then the tile and marble tiers, which are needed a bit later; the army
  // the garrison waits on, the mint, the herb hut and druids, and the homes' upgrades last.
  priority: [
    'opening',
    'bread',
    'brewery',
    'clothing',
    'tools',
    'weapons',
    'materials',
    'military',
    'coins',
    'healing',
    'homes',
  ],
};

/** What a seat with no base puts up: the headquarters declares an empty construction bill and would
 *  raise for free, so a warehouse takes the goods hub over instead. Only `building` and the placement
 *  modifiers are read; `count` is structural. */
export const BASE_REPLACEMENT_ENTRY: Extract<BuildOrderEntry, { kind: 'place' }> = {
  kind: 'place',
  building: 'stock_00',
  count: 1,
};

/** The opening's concurrent construction sites per seat, upgrade sites included (authored); the supply
 *  lines size their short line by it in every phase. */
export const MAX_ACTIVE_CONSTRUCTION_SITES = 2;

/** A seat that lost its base keeps to one site, so the replacement warehouse gets the whole crew and is
 *  never placed twice while its first site still stands unbuilt (authored). */
export const BASELESS_CONSTRUCTION_SITES = 1;

/** The opening's lookahead: how many steps of a line past its first one still waiting on a construction
 *  site the build order may act on (authored). A slow site holds its line back so the steps behind it
 *  never outrun the materials and inputs it brings; it is counted per line, since the lines feed nothing
 *  to each other in their own order and the site pace already bounds the sites all lines open at once. */
export const BUILD_ORDER_LOOKAHEAD_ENTRIES = 3;

/** How many sites a seat keeps open and how far past the oldest waiting one it looks, from `fromTick`. */
export interface SitePace {
  readonly fromTick: number;
  readonly sites: number;
  readonly lookahead: number;
}

/** The hard seat's pace by game clock (authored): the opening's two sites, a third with one more entry of
 *  lookahead from {@link SITES_GROW_FROM_TICKS}, a fourth with one more again from the late game, when the
 *  builder reserve grows to match (`workforce/staffing.ts`). */
export const SITE_PACE_STEPS: readonly SitePace[] = [
  { fromTick: 0, sites: MAX_ACTIVE_CONSTRUCTION_SITES, lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES },
  {
    fromTick: SITES_GROW_FROM_TICKS,
    sites: MAX_ACTIVE_CONSTRUCTION_SITES + 1,
    lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES + 1,
  },
  {
    fromTick: LATE_GAME_FROM_TICKS,
    sites: MAX_ACTIVE_CONSTRUCTION_SITES + 2,
    lookahead: BUILD_ORDER_LOOKAHEAD_ENTRIES + 2,
  },
];

/** The step of `profile`'s pace reached at `tick`. */
export function sitePace(profile: ComputerProfile, tick: number): SitePace {
  let pace = profile.sitePace[0];
  if (pace === undefined) throw new Error(`the ${profile.difficulty} site pace is empty`);
  for (const step of profile.sitePace) {
    if (tick >= step.fromTick) pace = step;
  }
  return pace;
}

/** How long a regressed entry, a razed building's, waits before the seat raises it again, counted from the
 *  last decision that saw the seat under attack (authored): long enough for a band that razed it to walk
 *  off, so the site is not flattened again as it rises. */
export const REBUILD_DELAY_TICKS = 30 * TICKS_PER_SECOND;

/** How far from the nearest of the seat's buildings a placement may land, in half-cell Manhattan nodes
 *  (authored): tight enough that the settlement grows as one piece. Every affinity pull stays inside it. */
export const BUILD_SEARCH_MAX_RADIUS_NODES = 32;

/** How many nodes of Manhattan distance from the base anchor cost a candidate spot one ring of distance
 *  from its search centre (authored): the affinity centre stays the main criterion and the base's
 *  closeness decides between spots about as near to it, so a settlement grows round rather than long. */
export const HQ_PULL_DIVISOR_NODES = 4;

/** The reach a placement falls back to when nothing inside {@link BUILD_SEARCH_MAX_RADIUS_NODES} takes the
 *  building, in the same nodes (authored): a base boxed in by forest or rock builds past it rather than
 *  waiting for the gatherers to clear it. */
export const OVERFLOW_BUILD_REACH_NODES = 2 * BUILD_SEARCH_MAX_RADIUS_NODES;

/** Decisions between the spot searches of an entry whose last search found nothing, a lane's and a
 *  passed-over entry's included, about 60 s at the decision interval. It never gives up, since felled
 *  trees or a razed building can free room later. Approximation: a tuned cadence, not an original value. */
export const STALLED_PLACEMENT_RETRY_DECISIONS = 15;
