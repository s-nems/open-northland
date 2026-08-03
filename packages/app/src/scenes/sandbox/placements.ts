import { resolveVikingBuilding } from '../../catalog/buildings.js';
import {
  GATHERERS,
  type GathererSpec,
  GOOD_GOLD,
  GOOD_IRON,
  GOOD_MUD,
  GOOD_MUSHROOM,
  GOOD_STONE,
  GOOD_WOOD,
} from '../../game/sandbox/index.js';

/** The coordinates satisfy `canPlaceBuilding`'s walls-outside-zones rule on the real extracted
 *  footprints, so the authored placements would also be legal interactively. */
export const VILLAGE: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> = [
  { id: 'home_level_00', x: 8, y: 7 },
  { id: 'home_level_01', x: 13, y: 7 },
  { id: 'home_level_02', x: 18, y: 7 },
  { id: 'home_level_03', x: 23, y: 7 },
  { id: 'home_level_04', x: 28, y: 7 },
  { id: 'school', x: 33, y: 7 },
  { id: 'work_temple', x: 39, y: 7 },
  { id: 'headquarters', x: 8, y: 15 },
  { id: 'stock_00', x: 14, y: 15 },
  { id: 'stock_01', x: 18, y: 15 },
  { id: 'stock_02', x: 22, y: 15 },
  { id: 'tower_00', x: 26, y: 15 },
  { id: 'tower_01', x: 29, y: 15 },
  { id: 'work_joinery_00', x: 8, y: 23 },
  { id: 'work_joinery_01', x: 12, y: 23 },
  { id: 'work_joinery_02', x: 16, y: 23 },
  { id: 'work_joinery_03', x: 20, y: 23 },
  { id: 'work_mason_hut_00', x: 25, y: 23 },
  { id: 'work_mason_hut_01', x: 31, y: 23 },
  { id: 'work_smithy_00', x: 38, y: 23 },
  { id: 'work_smithy_01', x: 43, y: 23 },
  { id: 'work_armory_00', x: 8, y: 31 },
  { id: 'work_armory_01', x: 13, y: 31 },
  { id: 'work_pottery_00', x: 17, y: 31 },
  { id: 'work_pottery_01', x: 22, y: 31 },
  { id: 'work_pottery_02', x: 27, y: 31 },
  { id: 'work_sewery_00', x: 31, y: 31 },
  { id: 'work_sewery_01', x: 36, y: 31 },
  { id: 'work_coin_mint', x: 41, y: 31 },
  { id: 'work_well_00', x: 8, y: 39 },
  { id: 'work_hive_00', x: 10, y: 39 },
  { id: 'work_mill_00', x: 13, y: 39 },
  { id: 'work_bakery_00', x: 18, y: 39 },
  { id: 'work_bakery_01', x: 23, y: 39 },
  { id: 'work_brewery', x: 28, y: 39 },
  { id: 'work_herb_hut', x: 33, y: 39 },
  { id: 'work_druid_00', x: 37, y: 39 },
  { id: 'work_druid_01', x: 42, y: 39 },
  // Farms and barracks take the bottom edge, where they have open grass to sow and graze.
  { id: 'work_farm_00', x: 8, y: 49 },
  { id: 'work_animal_farm', x: 13, y: 49 },
  { id: 'barracks', x: 20, y: 49 },
];

/** Distinct typeIds, so the five home levels collapse to one. */
export const VILLAGE_TYPE_IDS: ReadonlySet<number> = new Set(
  VILLAGE.map((b) => resolveVikingBuilding(b.id).typeId),
);

/** Seeded full (`fillStock`), so production has inputs from tick 1. */
export const WAREHOUSE_IDS: ReadonlySet<string> = new Set(['stock_00', 'stock_01', 'stock_02']);

/** `nodes` are offsets from `center`; the `gatherers` collectors are bound to `flag` and pinned to
 *  `good`. */
export interface GatherCamp {
  readonly good: number;
  readonly center: { readonly x: number; readonly y: number };
  readonly nodes: ReadonlyArray<{ readonly dx: number; readonly dy: number }>;
  readonly flag: { readonly x: number; readonly y: number };
  readonly gatherers: number;
}

const BLOB: ReadonlyArray<{ readonly dx: number; readonly dy: number }> = [
  { dx: 0, dy: 0 },
  { dx: 2, dy: -1 },
  { dx: -2, dy: 1 },
  { dx: 1, dy: 2 },
  { dx: -1, dy: -2 },
  { dx: 3, dy: 1 },
  { dx: -3, dy: -1 },
  { dx: 0, dy: 3 },
  { dx: 2, dy: -3 },
  { dx: -2, dy: 3 },
  { dx: 4, dy: -1 },
  { dx: -4, dy: 0 },
  { dx: 1, dy: -4 },
  { dx: -1, dy: 4 },
  { dx: 5, dy: 2 },
  { dx: -5, dy: 3 },
  { dx: 3, dy: 4 },
  { dx: -3, dy: -4 },
  { dx: 6, dy: 0 },
  { dx: 0, dy: -6 },
];

/** Camps sit close to the village for short hauls; each gatherer's good filter keeps overlapping flag
 *  radii from poaching a neighbour camp's nodes. */
export const CAMPS: readonly GatherCamp[] = [
  { good: GOOD_WOOD, center: { x: 10, y: 64 }, nodes: BLOB, flag: { x: 16, y: 62 }, gatherers: 4 },
  {
    good: GOOD_STONE,
    center: { x: 30, y: 60 },
    nodes: BLOB.slice(0, 8),
    flag: { x: 34, y: 58 },
    gatherers: 3,
  },
  { good: GOOD_MUD, center: { x: 44, y: 58 }, nodes: BLOB.slice(0, 6), flag: { x: 48, y: 55 }, gatherers: 2 },
  {
    good: GOOD_IRON,
    center: { x: 58, y: 24 },
    nodes: BLOB.slice(0, 6),
    flag: { x: 53, y: 23 },
    gatherers: 3,
  },
  {
    good: GOOD_GOLD,
    center: { x: 58, y: 36 },
    nodes: BLOB.slice(0, 5),
    flag: { x: 53, y: 35 },
    gatherers: 2,
  },
  {
    good: GOOD_MUSHROOM,
    center: { x: 54, y: 46 },
    nodes: BLOB.slice(0, 12),
    flag: { x: 50, y: 46 },
    gatherers: 2,
  },
];

/** Forage decor; `BUSH_FRUITS_GFX` is the fruited-bush `[GfxLandscape]` variant. */
export const BERRY_PATCH = { x: 60, y: 52 } as const;
export const BERRY_BUSHES = 6;
export const BUSH_FRUITS_GFX = 806;

export const GATHERER_BY_GOOD: ReadonlyMap<number, GathererSpec> = new Map(GATHERERS.map((g) => [g.good, g]));

/** Multiplies the catalog deposit size so the inspection world's camps outlast a session; at the
 *  catalog size a triple-staffed camp drains its outcrop in ~10 minutes of 1x play. */
export const MINE_DEPOSIT_SCALE = 100;
