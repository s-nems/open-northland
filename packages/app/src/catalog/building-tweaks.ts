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
