import type { LandscapeGfxRow } from './ir/rows.js';

/** The `EditGroups` of the maps' dungeon and fortress stonework. */
const STONEWORK_EDIT_GROUPS: ReadonlySet<string> = new Set(['misc_dungeon', 'xMissionCD_Dungeon']);
/** Of that stonework, the walls go by the word in their `EditName`; a door, pillar, torch or loose stone
 *  keeps standing on the ground as the original draws it. */
const WALL_NAME = /wall/i;
/** `EditGroups` that file one wall run's straights and corners together, whatever each piece is named. */
const WALL_RUN_EDIT_GROUPS: ReadonlySet<string> = new Set(['xMissionCD_ice wall']);
/** A bridge filed with its wall run spans a gap: its piers stand on nothing to sink into. */
const BRIDGE_NAME = /bridge/i;

/** Whether a map object is a built wall whose foot sets into the ground like a building's. */
export function isGroundedWall(record: Pick<LandscapeGfxRow, 'editName' | 'editGroups'>): boolean {
  const name = record.editName ?? '';
  const groups = record.editGroups ?? [];
  if (groups.some((group) => WALL_RUN_EDIT_GROUPS.has(group))) return !BRIDGE_NAME.test(name);
  return WALL_NAME.test(name) && groups.some((group) => STONEWORK_EDIT_GROUPS.has(group));
}
