import type { FootprintCell } from '@open-northland/data';

/**
 * Committed per-building geometry corrections over the extracted footprints — half-cell node offsets,
 * keyed by the catalog building id (`catalog/buildings.ts`).
 *
 * Source basis: the extracted `LogicDoorPoint` is faithful to the mod's data, but for a handful of
 * buildings it does not coincide with the door graphic as our renderer draws it. These shifts are the
 * user's visual sign-off with the admin geometry grid enabled in the sandbox (review of
 * 2026-07-10): every building was checked and only the ones below needed a nudge. They are a named
 * approximation (our render vs the authored data), not extraction fixes — applied at the one seam
 * where extracted footprints enter live content (`content/ir/joins.ts` `buildingFootprints`), so the sim's
 * walk-to-door target and the debug overlay can never disagree.
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
 * Where the worker-icon stack anchors, as an offset from the (shifted) door node — the anchor the
 * worker-icon badges and (for homes) the occupancy dots grow up from. The default — one node right of
 * the door, a half field — fits almost every workplace; the overrides come from gallery review (the
 * HQ's wide gangway wants the stack a node further out; the barracks' door wall runs down-right, so the
 * stack follows it). Homes push it a full field (two nodes) right so their occupancy dots clear the wide
 * house door graphic instead of sitting on it (user observation, 2026-07-17).
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

/** The worker-icon offset for a building id (the default when the id has no override / is unknown). */
export function workerIconOffset(buildingId?: string): FootprintCell {
  return (
    (buildingId !== undefined ? WORKER_ICON_OFFSETS.get(buildingId) : undefined) ?? DEFAULT_WORKER_ICON_OFFSET
  );
}
