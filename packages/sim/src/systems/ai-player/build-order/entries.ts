import { TICKS_PER_SECOND } from '../../../core/loop.js';
import { LATE_GAME_FROM_TICKS, SITES_GROW_FROM_TICKS } from '../game-phase.js';

/** Where a placement gravitates, on top of the always-on near-base rule; `placement.ts` resolves
 *  each kind to a node. `resource` is the good's nearest live deposit, or the seat's store holding the
 *  most of the good once none stands. `front` is the settlement's own edge toward the nearest enemy seat,
 *  its headquarters before any other building, and toward the map centre while no enemy has a building
 *  standing. */
export type PlacementAffinity =
  | { readonly kind: 'building'; readonly id: string }
  | { readonly kind: 'resource'; readonly good: string }
  | { readonly kind: 'mapCentre' }
  | { readonly kind: 'front' };

export type BuildOrderEntry =
  /** Place `count` buildings of the stable content id. `near` pulls the spot toward its anchors,
   *  `ground: 'plantable'` hard-restricts the footprint to sowable ground. `needsResources`
   *  names the map goods the building exists to work up; an unmet entry is skipped while the map holds
   *  none of any one of them, like a collector entry. `unlessWithin` skips the entry while every one of
   *  the seat's named buildings (at that tier or above) has one of the buildings the entry counts within
   *  `radius` world-metric nodes, or while the seat has none of those; a `near` affinity on the same id
   *  then pulls the spot toward the first one lacking. */
  | {
      readonly kind: 'place';
      readonly building: string;
      readonly count: number;
      readonly near?: readonly PlacementAffinity[];
      readonly ground?: 'plantable';
      readonly needsResources?: readonly string[];
      readonly unlessWithin?: { readonly building: string; readonly radius: number };
    }
  /** Upgrade owned buildings up their `upgradeTarget` chain until `count` stand at or above the
   *  named tier. */
  | { readonly kind: 'upgrade'; readonly building: string; readonly count: number }
  /** Wait for `count` (default 1) flag-bound gatherers of the good; the workforce module owns the hire
   *  and keeps at least that many. Posts past the first come out of spare men only, so the list holds
   *  here until the seat has them. A good with no live resource is skipped. */
  | { readonly kind: 'collector'; readonly good: string; readonly count?: number }
  /** Keep every owned building inside some tower's or the base's defence circle of `radius` nodes
   *  (default {@link TOWER_DEFENCE_RADIUS_NODES}). Unlike the counted entries it re-arms whenever a later
   *  building lands uncovered, so the tower count is dynamic. A `lane` entry runs beside the list once
   *  every counted entry before it stands met: it holds one site of its building at a time, taken out of
   *  the clock's site count, never stalls the entries behind it, and they never wait on it. */
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

/** Whether `entry` is a lane running beside the list rather than a step of it. */
export function isLaneEntry(entry: BuildOrderEntry): boolean {
  return (entry.kind === 'towerCoverage' || entry.kind === 'storeCoverage') && entry.lane === true;
}

/** The late tail's denser tower ring, in world-metric nodes (authored): tighter than the opening
 *  {@link TOWER_DEFENCE_RADIUS_NODES}, so the finished settlement stands under overlapping towers. */
export const DENSE_TOWER_RADIUS_NODES = 14;

/** How near a water-drinking workshop (the bakery, the brewery, the animal farm) a well must stand to
 *  serve it, in world-metric nodes (authored); a farther one gets another well beside the workshop. */
export const WELL_REACH_NODES = 12;

/** How near a brewery its hive must stand to count as its honey source, in world-metric nodes (authored):
 *  wider than the well's reach, since the well entry serving the same brewery comes first in the list and
 *  takes the nearest room, and the brewer's carrier walks the little further for honey. */
export const HIVE_REACH_NODES = 18;

/** How far a store's coverage reaches, in world-metric nodes (authored): well over a tower's, since a
 *  warehouse serves carriers rather than bows, and the base is a store too. */
export const STORE_COVERAGE_RADIUS_NODES = 32;

/** The two deposits a joinery or a smithy draws on, in the order its recipes weigh them. */
const WOOD_AND_IRON: readonly PlacementAffinity[] = [
  { kind: 'resource', good: 'wood' },
  { kind: 'resource', good: 'iron' },
];
const IRON_AND_WOOD: readonly PlacementAffinity[] = [
  { kind: 'resource', good: 'iron' },
  { kind: 'resource', good: 'wood' },
];

/**
 * Authored: the opening list is a plan, not extracted data. It is ordered so each entry's materials
 * already exist when it is reached, because a placement charges the merged bill of its whole tier chain
 * and one unbuildable bill stalls every entry behind it. Its `_01` workshop and `home_level_04` entries
 * build straight to that tier because the extracted `jobEnablesHouse` rows enable each tier as a
 * separately placeable house type charging its own non-cumulative bill. Weapon shops sit in the opening
 * rather than the tail, since the garrison rung publishes only the classes it can arm right now.
 */
export const DEFAULT_BUILD_ORDER: readonly BuildOrderEntry[] = [
  { kind: 'place', building: 'work_farm_00', count: 1, ground: 'plantable' },
  { kind: 'place', building: 'home_level_00', count: 3 },
  { kind: 'place', building: 'work_pottery_00', count: 1, near: [{ kind: 'resource', good: 'mud' }] },
  { kind: 'place', building: 'work_mason_hut_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
  { kind: 'place', building: 'work_mill_00', count: 1, near: [{ kind: 'building', id: 'work_farm_00' }] },
  // Bread is the food the seat runs short of first, so the second bakery follows the first at once.
  { kind: 'place', building: 'work_bakery_00', count: 2, near: [{ kind: 'building', id: 'work_mill_00' }] },
  {
    kind: 'place',
    building: 'work_well_00',
    count: 1,
    near: [
      { kind: 'building', id: 'work_mill_00' },
      { kind: 'building', id: 'work_bakery_00' },
    ],
  },
  { kind: 'upgrade', building: 'home_level_02', count: 3 },
  // The brewery comes first and fixes where its honey and water come from: the hive beside it, and a
  // second well beside it too when the first one stands farther off.
  { kind: 'place', building: 'work_brewery', count: 1, near: [{ kind: 'building', id: 'work_well_00' }] },
  { kind: 'place', building: 'work_hive_00', count: 1, near: [{ kind: 'building', id: 'work_brewery' }] },
  {
    kind: 'place',
    building: 'work_well_00',
    count: 2,
    near: [{ kind: 'building', id: 'work_brewery' }],
    unlessWithin: { building: 'work_brewery', radius: WELL_REACH_NODES },
  },
  // Tiles and marble come only from these tiers, and homes, the armory and the bakeries all wait on them,
  // so the upgrades land well before the first bill that needs them.
  { kind: 'upgrade', building: 'work_pottery_01', count: 1 },
  { kind: 'upgrade', building: 'work_mason_hut_01', count: 1 },
  {
    kind: 'place',
    building: 'work_animal_farm',
    count: 1,
    near: [
      { kind: 'building', id: 'work_farm_00' },
      { kind: 'building', id: 'work_well_00' },
    ],
  },
  // The animal farm drinks water like the brewery, so it gets a well beside it when none stands in reach.
  // The count only caps the seat's wells: the entry is skipped once any well stands within reach.
  {
    kind: 'place',
    building: 'work_well_00',
    count: 3,
    near: [{ kind: 'building', id: 'work_animal_farm' }],
    unlessWithin: { building: 'work_animal_farm', radius: WELL_REACH_NODES },
  },
  {
    kind: 'place',
    building: 'work_sewery_01',
    count: 1,
    near: [{ kind: 'building', id: 'work_animal_farm' }],
  },
  // The joinery works iron tools out of wood and iron, the smithy its wares out of iron and wood: each
  // stands between its two deposits, so neither carrier walks far.
  { kind: 'place', building: 'work_joinery_01', count: 1, near: WOOD_AND_IRON },
  { kind: 'collector', good: 'iron' },
  { kind: 'place', building: 'work_smithy_01', count: 1, near: IRON_AND_WOOD },
  // On the settlement's edge toward the nearest enemy, where the attacks come from; the barracks also
  // holds the line in defence.
  { kind: 'place', building: 'barracks', count: 1, near: [{ kind: 'front' }] },
  // The armourer turns wood into bows and spear shafts, so it stands by the wood like the joinery.
  { kind: 'place', building: 'work_armory_01', count: 1, near: [{ kind: 'resource', good: 'wood' }] },
  { kind: 'upgrade', building: 'home_level_03', count: 3 },
  { kind: 'upgrade', building: 'home_level_04', count: 3 },
  { kind: 'upgrade', building: 'work_bakery_01', count: 2 },
  { kind: 'towerCoverage', building: 'tower_01' },
  { kind: 'place', building: 'work_smithy_01', count: 2, near: IRON_AND_WOOD },
  { kind: 'place', building: 'home_level_04', count: 5 },
  // The small tailor, a second shoemaker: counted with the upgraded one, so this adds one building.
  {
    kind: 'place',
    building: 'work_sewery_00',
    count: 2,
    near: [{ kind: 'building', id: 'work_sewery_01' }],
  },
  // The healing line: the big potion takes herbs, mushrooms and coins, and the temple waits on the
  // druids' oil, so all of it stands only where the map holds both gold and mushrooms.
  { kind: 'collector', good: 'mushroom' },
  { kind: 'collector', good: 'gold' },
  {
    kind: 'place',
    building: 'work_coin_mint',
    count: 2,
    near: [{ kind: 'resource', good: 'gold' }],
    needsResources: ['gold'],
  },
  // The herb hut comes first, beside a well, so its herbs are growing when the druids it draws beside it
  // stand.
  {
    kind: 'place',
    building: 'work_herb_hut',
    count: 1,
    near: [{ kind: 'building', id: 'work_well_00' }],
    ground: 'plantable',
    needsResources: ['mushroom', 'gold'],
  },
  {
    kind: 'place',
    building: 'work_druid_01',
    count: 2,
    near: [{ kind: 'building', id: 'work_herb_hut' }],
    needsResources: ['mushroom', 'gold'],
  },
  { kind: 'place', building: 'work_smithy_01', count: 4, near: IRON_AND_WOOD },
  // Beside the barracks: the temple stands with the army it blesses, not on a front of its own.
  {
    kind: 'place',
    building: 'work_temple',
    count: 1,
    near: [{ kind: 'building', id: 'barracks' }],
    needsResources: ['mushroom', 'gold'],
  },
  { kind: 'place', building: 'work_bakery_01', count: 4, near: [{ kind: 'building', id: 'work_mill_00' }] },
  // Every bakery drinks water like the brewery: one standing beyond a well's reach gets a well beside it.
  {
    kind: 'place',
    building: 'work_well_00',
    count: 5,
    near: [{ kind: 'building', id: 'work_bakery_00' }],
    unlessWithin: { building: 'work_bakery_00', radius: WELL_REACH_NODES },
  },
  // Beside the first, sharing its hive and well when they stand in reach; a second hive and well beside
  // it otherwise.
  { kind: 'place', building: 'work_brewery', count: 2, near: [{ kind: 'building', id: 'work_brewery' }] },
  {
    kind: 'place',
    building: 'work_hive_00',
    count: 2,
    near: [{ kind: 'building', id: 'work_brewery' }],
    unlessWithin: { building: 'work_brewery', radius: HIVE_REACH_NODES },
  },
  {
    kind: 'place',
    building: 'work_well_00',
    count: 6,
    near: [{ kind: 'building', id: 'work_brewery' }],
    unlessWithin: { building: 'work_brewery', radius: WELL_REACH_NODES },
  },
  { kind: 'place', building: 'home_level_04', count: 8 },
  // The late game runs out of mail, plate and long bows.
  { kind: 'place', building: 'work_smithy_01', count: 5, near: [{ kind: 'resource', good: 'iron' }] },
  { kind: 'place', building: 'work_armory_01', count: 2, near: [{ kind: 'resource', good: 'wood' }] },
  // The strength-amulet mint, and two more druid huts on the big healing potion with a mushroom gatherer
  // to feed them.
  {
    kind: 'place',
    building: 'work_coin_mint',
    count: 3,
    near: [{ kind: 'resource', good: 'gold' }],
    needsResources: ['gold'],
  },
  { kind: 'collector', good: 'mushroom', count: 2 },
  {
    kind: 'place',
    building: 'work_druid_01',
    count: 4,
    near: [{ kind: 'building', id: 'work_druid_01' }],
    needsResources: ['mushroom', 'gold'],
  },
  // The third brewery beside the first two, with its own hive and well by the same rule.
  { kind: 'place', building: 'work_brewery', count: 3, near: [{ kind: 'building', id: 'work_brewery' }] },
  {
    kind: 'place',
    building: 'work_hive_00',
    count: 3,
    near: [{ kind: 'building', id: 'work_brewery' }],
    unlessWithin: { building: 'work_brewery', radius: HIVE_REACH_NODES },
  },
  {
    kind: 'place',
    building: 'work_well_00',
    count: 7,
    near: [{ kind: 'building', id: 'work_brewery' }],
    unlessWithin: { building: 'work_brewery', radius: WELL_REACH_NODES },
  },
  // From here the warehouses and the denser tower ring run as lanes beside the list, one site each out of
  // the four the late game opens (owner's rule): a warehouse wherever a workshop or a work flag stands
  // beyond every store's reach, so the smithies unload nearby and the ore piled at the mines gets carried
  // in; a tower wherever the ring leaves a building out. A filled settlement with no room for a tower
  // holds the lane, not the list.
  { kind: 'storeCoverage', building: 'stock_02', radius: STORE_COVERAGE_RADIUS_NODES, lane: true },
  { kind: 'towerCoverage', building: 'tower_01', radius: DENSE_TOWER_RADIUS_NODES, lane: true },
  // The other two sites go on down the list: two more smithies, the joinery at its top tier for a third
  // joiner on iron tools, and two more druid huts on the big healing potion.
  { kind: 'place', building: 'work_smithy_01', count: 7, near: IRON_AND_WOOD },
  { kind: 'upgrade', building: 'work_joinery_03', count: 1 },
  {
    kind: 'place',
    building: 'work_druid_01',
    count: 6,
    near: [{ kind: 'building', id: 'work_druid_01' }],
    needsResources: ['mushroom', 'gold'],
  },
];

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

/** The opening's lookahead: how many entries past the first one still waiting on a construction site the
 *  build order may act on (authored). A slow site holds the list back so the entries behind it never
 *  outrun the materials it brings. */
export const BUILD_ORDER_LOOKAHEAD_ENTRIES = 3;

/** How many sites a seat keeps open and how far past the oldest waiting one it looks, from `fromTick`. */
export interface SitePace {
  readonly fromTick: number;
  readonly sites: number;
  readonly lookahead: number;
}

/** The pace by game clock (authored): the opening's two sites, a third with one more entry of lookahead
 *  from {@link SITES_GROW_FROM_TICKS}, a fourth with one more again from the late game, when the builder
 *  reserve grows to match (`workforce/staffing.ts`). */
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

/** The {@link SITE_PACE_STEPS} step reached at `tick`. */
export function sitePace(tick: number): SitePace {
  let pace = SITE_PACE_STEPS[0];
  if (pace === undefined) throw new Error('SITE_PACE_STEPS is empty');
  for (const step of SITE_PACE_STEPS) {
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

/** Decisions between a stalled placement's spot searches, about 60 s at the decision interval. It never
 *  gives up, since felled trees or a razed building can free room later. Approximation: a tuned
 *  cadence, not an original value. */
export const STALLED_PLACEMENT_RETRY_DECISIONS = 30;
