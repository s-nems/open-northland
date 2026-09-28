import type { FootprintCell } from '@open-northland/data';

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
