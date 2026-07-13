import type { FootprintCell } from '@open-northland/data';

/**
 * Committed per-building GEOMETRY CORRECTIONS over the extracted footprints — half-cell node offsets,
 * keyed by the catalog building id (`catalog/buildings.ts`).
 *
 * Source basis: the extracted `LogicDoorPoint` is faithful to the mod's data, but for a handful of
 * buildings it does not coincide with the DOOR GRAPHIC as our renderer draws it. These shifts are the
 * user's visual sign-off with the admin geometry grid enabled in the sandbox (review of
 * 2026-07-10): every building was checked and only the ones below needed a nudge. They are a named
 * approximation (our render vs the authored data), not extraction fixes — applied at the ONE seam
 * where extracted footprints enter live content (`content/ir.ts` `buildingFootprints`), so the sim's
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
 * Where the worker-icon stack anchors, as an offset from the (shifted) DOOR node. The default — one
 * node right of the door — fits almost every building; the overrides come from the same gallery
 * review (the HQ's wide gangway wants the stack a node further out; the barracks' door wall runs
 * down-right, so the stack follows it).
 */
export const DEFAULT_WORKER_ICON_OFFSET: FootprintCell = { dx: 1, dy: 0 };
const WORKER_ICON_OFFSETS: ReadonlyMap<string, FootprintCell> = new Map([
  ['headquarters', { dx: 2, dy: 0 }],
  ['barracks', { dx: 1, dy: 1 }],
]);

/** The worker-icon offset for a building id (the default when the id has no override / is unknown). */
export function workerIconOffset(buildingId?: string): FootprintCell {
  return (
    (buildingId !== undefined ? WORKER_ICON_OFFSETS.get(buildingId) : undefined) ?? DEFAULT_WORKER_ICON_OFFSET
  );
}
