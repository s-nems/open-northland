import type { FootprintCell } from '@open-northland/data';
import type { ErasedRegion, FiringPost } from '@open-northland/render';
import { BUILDING_HOME_03, BUILDING_HOME_04 } from '../game/sandbox/ids/buildings.js';
import { VIKING } from './buildings.js';

/**
 * Where the worker-icon and occupancy badges anchor, as an offset from the door node. The default of one
 * node right of the door fits almost every workplace; each override follows its own building's door
 * wall, and homes push a full field right so the dots clear the wide door graphic (observation).
 */
export const DEFAULT_WORKER_ICON_OFFSET: FootprintCell = { dx: 1, dy: 0 };
const HOME_OCCUPANCY_OFFSET: FootprintCell = { dx: 2, dy: 0 };
const WORKER_ICON_OFFSETS: ReadonlyMap<string, FootprintCell> = new Map([
  ['headquarters', { dx: 2, dy: 0 }],
  ['barracks', { dx: 1, dy: 1 }],
  ['home_level_00', HOME_OCCUPANCY_OFFSET],
  ['home_level_01', HOME_OCCUPANCY_OFFSET],
  ['home_level_02', HOME_OCCUPANCY_OFFSET],
  ['home_level_03', HOME_OCCUPANCY_OFFSET],
  ['home_level_04', HOME_OCCUPANCY_OFFSET],
]);

/** The worker-icon offset for a building id, falling back to the default for an id with no override. */
export function workerIconOffset(buildingId?: string): FootprintCell {
  return (
    (buildingId !== undefined ? WORKER_ICON_OFFSETS.get(buildingId) : undefined) ?? DEFAULT_WORKER_ICON_OFFSET
  );
}

/** A garrison mast's foot in bob-anchor px (+y down), and the height from which down the flag draws
 *  behind the tower's body, so the parts of the roof in front of the pole cover it. */
export interface PlacedGarrisonMast {
  readonly x: number;
  readonly y: number;
  readonly behindFrom?: number;
}

/**
 * Garrison masts for the tower records that author no `gfxsoldierflagpoint`, keyed by the record's
 * `EditName`, for every level of the record: without one the flag stands at the door. Approximation:
 * placed on each drawn roof by eye.
 */
export const PLACED_GARRISON_MASTS: ReadonlyMap<string, PlacedGarrisonMast> = new Map([
  // Standing behind the front merlons, whose tops the cut follows, so the pole rises from them and the
  // cloth's lower corner tucks behind the side merlons.
  ['byzantine tower', { x: 10, y: -212, behindFrom: -209 }],
  // On the spire's tip, in front of the crescent.
  ['saracen tower', { x: 29, y: -267 }],
  // The middle of the flat wooden roof.
  ['Egypt Tower', { x: 6, y: -228 }],
]);

/**
 * The level each tower record's garrison shoots from in defence mode, keyed by `EditName` for every level
 * of the record, in bob-anchor px (+y down): the middle of the firing level and the radius of the ring the
 * archers stand on. Approximation: placed on each drawn body by eye, the viking gallery and the windows
 * under its stone tower's roof, the frank and byzantine battlements, the saracen windows under the dome
 * and the egypt roof platform.
 */
export const TOWER_FIRING_POSTS: ReadonlyMap<string, FiringPost> = new Map([
  ['viking tower', { x: -4, y: -146, halfWidth: 38 }],
  ['frank tower', { x: -5, y: -212, halfWidth: 50 }],
  ['byzantine tower', { x: 3, y: -225, halfWidth: 42 }],
  ['saracen tower', { x: 28, y: -162, halfWidth: 26 }],
  ['Egypt Tower', { x: 0, y: -195, halfWidth: 50 }],
]);

/**
 * The roof finial a tower's garrison flag replaces, keyed by the record's `EditName` for every level, in
 * bob-anchor px like the masts: the frank tower's pennant, a cut above its spire and a band right of
 * it, and the saracen tower's crescent. Intentional deviation: the original draws the flag over the
 * body's own finial, which shows through the gaps of the wave; boxes measured on the drawn bodies.
 */
export const GARRISON_FINIALS: ReadonlyMap<string, ErasedRegion> = new Map([
  [
    'frank tower',
    [
      { minX: -9, minY: -316, maxX: 25, maxY: -290 },
      { minX: 2, minY: -290, maxX: 25, maxY: -279 },
    ],
  ],
  ['saracen tower', [{ minX: 14, minY: -289, maxX: 41, maxY: -266 }]],
]);

/**
 * `GfxPalette` skins appended to one building type's `[GfxHouse]` rows, so its buildings cycle them by id
 * like the records that list several. Intentional deviation: the original draws every viking home in
 * `house01`; `house02`, which the viking workshops already carry, turns the tiled roofs of home levels 4
 * and 5 blue-grey. Level 3 keeps one look because its upper plank roof stays brown in either palette.
 */
export interface AddedHousePalettes {
  readonly tribeId: number;
  readonly typeId: number;
  readonly palettes: readonly string[];
}

export const ADDED_HOUSE_PALETTES: readonly AddedHousePalettes[] = [
  { tribeId: VIKING, typeId: BUILDING_HOME_03, palettes: ['house02'] },
  { tribeId: VIKING, typeId: BUILDING_HOME_04, palettes: ['house02'] },
];
