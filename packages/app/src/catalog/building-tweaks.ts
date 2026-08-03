import type { FootprintCell } from '@open-northland/data';

/**
 * Committed per-building geometry corrections over the extracted footprints: half-cell node offsets,
 * keyed by the catalog building id.
 *
 * Source basis: the extracted `LogicDoorPoint` is faithful to the mod's data, but for a handful of
 * buildings it does not coincide with the door graphic as this renderer draws it. The shifts are an
 * approximation from visual review, applied at the one seam where extracted footprints enter live
 * content, so the sim's walk-to-door target and the debug overlay can never disagree.
 */

/** Door-cell shift per building id, added to the extracted `footprint.door` offset. */
export const DOOR_SHIFTS: ReadonlyMap<string, FootprintCell> = new Map([
  ['home_level_00', { dx: 1, dy: 0 }],
  ['home_level_01', { dx: 1, dy: 0 }],
  ['home_level_02', { dx: 1, dy: 0 }],
  ['home_level_03', { dx: 1, dy: 0 }],
  ['home_level_04', { dx: 1, dy: 0 }],
  ['work_farm_00', { dx: 1, dy: 1 }],
  ['work_coin_mint', { dx: 1, dy: 0 }],
  ['barracks', { dx: 1, dy: 0 }],
  ['tower_00', { dx: 1, dy: 0 }],
  ['tower_01', { dx: 1, dy: 0 }],
]);

/**
 * Where the worker-icon and occupancy badges anchor, as an offset from the shifted door node. The
 * default of one node right of the door fits almost every workplace; each override follows its own
 * building's door wall, and homes push a full field right so the dots clear the wide door graphic
 * (observation).
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
