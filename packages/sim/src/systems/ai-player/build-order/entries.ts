/**
 * The build-order vocabulary — the data the HouseBuild executor walks (genre convention: an
 * authored opening list executes before any demand logic; Widelands "basic economy" / KaM classic
 * AI / AoE2 opening books). Entries are a discriminated union: place a building, upgrade owned
 * buildings toward a tier, or wait for a flag collector the workforce module hires.
 */

/** Where a placement should gravitate, on top of the always-on near-HQ rule: toward the seat's
 *  first building of a stable content id, toward the nearest live resource of a good, or toward
 *  the map's centre (the barracks rule — face the contested middle, not the town's back). */
export type PlacementAffinity =
  | { readonly kind: 'building'; readonly id: string }
  | { readonly kind: 'resource'; readonly good: string }
  | { readonly kind: 'mapCentre' };

export type BuildOrderEntry =
  /** Place `count` buildings of the stable content id. Owned buildings at the placed tier OR any
   *  tier above it on the `upgradeTarget` chain count (a `home`-kind id counts every home tier) —
   *  an upgraded building must not trigger a replacement. `near` pulls the spot toward its
   *  anchors; `ground: 'plantable'` restricts the footprint to sowable ground (a hard rule — no
   *  legal spot stalls the list, user decision 2026-07-18). */
  | {
      readonly kind: 'place';
      readonly building: string;
      readonly count: number;
      readonly near?: readonly PlacementAffinity[];
      readonly ground?: 'plantable';
    }
  /** Upgrade owned buildings up their `upgradeTarget` chain until `count` stand at (or above) the
   *  target tier named by the stable content id. */
  | { readonly kind: 'upgrade'; readonly building: string; readonly count: number }
  /** Wait for one flag-bound gatherer of the good (hired by the workforce module once the list
   *  reaches this entry — see `collectorGoodsWanted`). A good with no live resource is skipped. */
  | { readonly kind: 'collector'; readonly good: string };

/**
 * The opening list (source: the user's authored plan, 2026-07-17, extended and revised
 * 2026-07-18). The affinities encode the plan's adjacency rules: the mason leans toward the stone
 * deposit and the pottery toward the clay pit (both still near the HQ), the farm→mill→bakery/well
 * chain clusters, and the hive/brewery/animal-farm cluster hangs off the well. Level-2 workshops
 * (sewery, joinery, smithy) are built at their level-2 tier DIRECTLY — no level-0 intermediate
 * (user decision 2026-07-18). The iron collector is hired only when the list reaches it. The tail
 * is material-ordered: the pottery/mason upgrades unlock tile and ornament, which the level-4/5
 * home upgrades then consume; the barracks faces the map centre; the bakery upgrade comes last and
 * gains a second baker (`OPERATORS_PER_TRADE_BY_BUILDING_ID`).
 */
export const DEFAULT_BUILD_ORDER: readonly BuildOrderEntry[] = [
  { kind: 'place', building: 'work_farm_00', count: 1, ground: 'plantable' },
  { kind: 'place', building: 'home_level_00', count: 3 },
  { kind: 'place', building: 'work_pottery_00', count: 1, near: [{ kind: 'resource', good: 'mud' }] },
  { kind: 'place', building: 'work_mason_hut_00', count: 1, near: [{ kind: 'resource', good: 'stone' }] },
  { kind: 'place', building: 'work_mill_00', count: 1, near: [{ kind: 'building', id: 'work_farm_00' }] },
  { kind: 'place', building: 'work_bakery_00', count: 1, near: [{ kind: 'building', id: 'work_mill_00' }] },
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
  { kind: 'upgrade', building: 'work_pottery_01', count: 1 },
  { kind: 'upgrade', building: 'work_mason_hut_01', count: 1 },
  { kind: 'place', building: 'barracks', count: 1, near: [{ kind: 'mapCentre' }] },
  { kind: 'upgrade', building: 'home_level_03', count: 3 },
  { kind: 'upgrade', building: 'home_level_04', count: 3 },
  { kind: 'upgrade', building: 'work_bakery_01', count: 1 },
];

/** Concurrent construction sites per seat — upgrades included (user rule, 2026-07-18: exactly one
 *  site at a time). */
export const MAX_ACTIVE_CONSTRUCTION_SITES = 1;

/** How far from the headquarters a placement may land, in half-cell Manhattan nodes — the bounded
 *  neighbourhood every affinity pull stays inside. Beyond it the executor stalls (expansion's
 *  concern). */
export const BUILD_SEARCH_MAX_RADIUS_NODES = 48;
