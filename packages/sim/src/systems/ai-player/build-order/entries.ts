import { TICKS_PER_SECOND } from '../../../core/loop.js';

/** Where a placement gravitates, on top of the always-on near-base rule; `placement.ts` resolves
 *  each kind to a node. */
export type PlacementAffinity =
  | { readonly kind: 'building'; readonly id: string }
  | { readonly kind: 'resource'; readonly good: string }
  | { readonly kind: 'mapCentre' }
  | { readonly kind: 'outskirts' };

export type BuildOrderEntry =
  /** Place `count` buildings of the stable content id. `near` pulls the spot toward its anchors,
   *  `ground: 'plantable'` hard-restricts the footprint to sowable ground, and `apart` prefers
   *  (never requires) a spot clear of the seat's other buildings of the same kind. `needsResources`
   *  names the map goods the building exists to work up; an unmet entry is skipped while the map holds
   *  none of any one of them, like a collector entry. */
  | {
      readonly kind: 'place';
      readonly building: string;
      readonly count: number;
      readonly near?: readonly PlacementAffinity[];
      readonly ground?: 'plantable';
      readonly apart?: boolean;
      readonly needsResources?: readonly string[];
    }
  /** Upgrade owned buildings up their `upgradeTarget` chain until `count` stand at or above the
   *  named tier. */
  | { readonly kind: 'upgrade'; readonly building: string; readonly count: number }
  /** Wait for one flag-bound gatherer of the good; the workforce module owns the hire. A good with
   *  no live resource is skipped. */
  | { readonly kind: 'collector'; readonly good: string }
  /** Keep every owned building inside some tower's or the base's defence circle of `radius` nodes
   *  (default {@link TOWER_DEFENCE_RADIUS_NODES}). Unlike the counted entries it re-arms whenever a later
   *  building lands uncovered, so the tower count is dynamic. */
  | { readonly kind: 'towerCoverage'; readonly building: string; readonly radius?: number }
  /** The same rule over the seat's stores: every owned building within `radius` nodes of the base or a
   *  warehouse, so goods never travel far to a store. */
  | { readonly kind: 'storeCoverage'; readonly building: string; readonly radius: number };

/** The late tail's denser tower ring, in world-metric nodes (authored): tighter than the opening
 *  {@link TOWER_DEFENCE_RADIUS_NODES}, so the finished settlement stands under overlapping towers. */
export const DENSE_TOWER_RADIUS_NODES = 15;

/** How far a store's coverage reaches, in world-metric nodes (authored): wider than a tower's, since a
 *  warehouse serves carriers rather than bows. */
export const STORE_COVERAGE_RADIUS_NODES = 32;

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
  { kind: 'place', building: 'work_hive_00', count: 1, near: [{ kind: 'building', id: 'work_well_00' }] },
  {
    kind: 'place',
    building: 'work_brewery',
    count: 1,
    near: [
      { kind: 'building', id: 'work_well_00' },
      { kind: 'building', id: 'work_hive_00' },
    ],
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
  {
    kind: 'place',
    building: 'work_sewery_01',
    count: 1,
    near: [{ kind: 'building', id: 'work_animal_farm' }],
  },
  { kind: 'place', building: 'work_joinery_01', count: 1, near: [{ kind: 'resource', good: 'wood' }] },
  { kind: 'collector', good: 'iron' },
  { kind: 'place', building: 'work_smithy_01', count: 1, near: [{ kind: 'resource', good: 'iron' }] },
  { kind: 'place', building: 'barracks', count: 1, near: [{ kind: 'mapCentre' }] },
  { kind: 'place', building: 'work_armory_01', count: 1, near: [{ kind: 'building', id: 'work_smithy_01' }] },
  { kind: 'upgrade', building: 'home_level_03', count: 3 },
  { kind: 'upgrade', building: 'home_level_04', count: 3 },
  { kind: 'upgrade', building: 'work_bakery_01', count: 2 },
  { kind: 'towerCoverage', building: 'tower_01' },
  {
    kind: 'place',
    building: 'work_brewery',
    count: 2,
    near: [
      { kind: 'building', id: 'work_well_00' },
      { kind: 'building', id: 'work_hive_00' },
    ],
  },
  { kind: 'place', building: 'work_smithy_01', count: 2, near: [{ kind: 'resource', good: 'iron' }] },
  { kind: 'place', building: 'home_level_04', count: 5 },
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
  {
    kind: 'place',
    building: 'work_druid_01',
    count: 2,
    near: [{ kind: 'building', id: 'work_well_00' }],
    needsResources: ['mushroom', 'gold'],
  },
  {
    kind: 'place',
    building: 'work_herb_hut',
    count: 1,
    near: [{ kind: 'building', id: 'work_druid_01' }],
    ground: 'plantable',
    needsResources: ['mushroom', 'gold'],
  },
  { kind: 'place', building: 'work_smithy_01', count: 4, near: [{ kind: 'resource', good: 'iron' }] },
  // Toward the front like the barracks.
  {
    kind: 'place',
    building: 'work_temple',
    count: 1,
    near: [{ kind: 'mapCentre' }],
    needsResources: ['mushroom', 'gold'],
  },
  { kind: 'place', building: 'stock_02', count: 2, near: [{ kind: 'outskirts' }], apart: true },
  { kind: 'place', building: 'work_bakery_01', count: 4, near: [{ kind: 'building', id: 'work_mill_00' }] },
  { kind: 'place', building: 'home_level_04', count: 8 },
  { kind: 'place', building: 'stock_02', count: 3, near: [{ kind: 'outskirts' }], apart: true },
  { kind: 'storeCoverage', building: 'stock_02', radius: STORE_COVERAGE_RADIUS_NODES },
  { kind: 'towerCoverage', building: 'tower_01', radius: DENSE_TOWER_RADIUS_NODES },
];

/** What a seat with no base puts up: the headquarters declares an empty construction bill and would
 *  raise for free, so a warehouse takes the goods hub over instead. Only `building` and the placement
 *  modifiers are read; `count` is structural. */
export const BASE_REPLACEMENT_ENTRY: Extract<BuildOrderEntry, { kind: 'place' }> = {
  kind: 'place',
  building: 'stock_00',
  count: 1,
};

/** Concurrent construction sites per seat, upgrade sites included (authored). */
export const MAX_ACTIVE_CONSTRUCTION_SITES = 2;

/** A seat that lost its base keeps to one site, so the replacement warehouse gets the whole crew and is
 *  never placed twice while its first site still stands unbuilt (authored). */
export const BASELESS_CONSTRUCTION_SITES = 1;

/** How many entries past the first one still waiting on a construction site the build order may act on
 *  (authored): a slow site holds the list back so the entries behind it never outrun the materials it
 *  brings. */
export const BUILD_ORDER_LOOKAHEAD_ENTRIES = 3;

/** How long a regressed entry, a razed building's, waits before the seat raises it again (authored). */
export const REBUILD_DELAY_TICKS = 15 * TICKS_PER_SECOND;

/** How far from the seat's base a placement may land, in half-cell Manhattan nodes; every affinity
 *  pull stays inside this disc. */
export const BUILD_SEARCH_MAX_RADIUS_NODES = 48;

/** Decisions between a stalled placement's spot searches, about 60 s at the decision interval. It never
 *  gives up, since felled trees or a razed building can free room later. Approximation: a tuned
 *  cadence, not an original value. */
export const STALLED_PLACEMENT_RETRY_DECISIONS = 30;
