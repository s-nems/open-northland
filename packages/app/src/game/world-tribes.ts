import type { MapScript, TerrainMapFile } from '@open-northland/data';
import { PRIMARY_TRIBE } from './rules.js';
import { type AuthoredJoinRows, contentJoins } from './world/index.js';

/**
 * The civilizations one world draws, the first of which is the base: it backs a building type or a
 * character look the other tribes do not skin, and an entity of a tribe whose art was never loaded.
 * Non-empty by construction, so a consumer never needs a fallback of its own.
 */
export type WorldTribes = readonly [number, ...number[]];

/** The highest `TRIBE_TYPE_HUMAN_*` id (`logicdefines.inc`): above it the ids are animal species, which
 *  draw through the wildlife lane rather than a civilization's bob sets. */
const LAST_HUMAN_TRIBE = 7;

/**
 * The civilizations a world fields: the seats' roster tribes plus the tribes of every authored building
 * and settler. Each one costs its own building and settler atlas pages, so the loaders take this set
 * rather than every tribe the content describes.
 */
export function worldTribes(
  script: Pick<MapScript, 'players'> | null,
  entities: TerrainMapFile['entities'],
  rows: AuthoredJoinRows,
): WorldTribes {
  // The base is pinned even on a map that fields no viking: it backs every building type and character
  // look the other tribes do not skin, at the cost of its own pages on such a map.
  const tribes = new Set<number>([PRIMARY_TRIBE]);
  const add = (tribe: number | undefined): void => {
    if (tribe !== undefined && tribe > 0 && tribe <= LAST_HUMAN_TRIBE) tribes.add(tribe);
  };
  for (const seat of script?.players ?? []) add(seat.tribeId);
  // The same joins the placements themselves resolve through, so the art loaded and the tribe the sim
  // stamps can never disagree.
  const joins = contentJoins(rows);
  for (const human of entities?.humans ?? []) add(joins.tribe(human.tribe));
  for (const building of entities?.buildings ?? []) {
    add(joins.buildingBob(building.name, building.level)?.tribeId);
  }
  return [PRIMARY_TRIBE, ...[...tribes].filter((t) => t !== PRIMARY_TRIBE).sort((a, b) => a - b)];
}
