import { type FootprintCell, levelBlockAreaCells } from '@open-northland/data';
import type { ScriptLandscapeType } from '../../nav/terrain/index.js';

export interface PlacementBlockCells {
  readonly walk: readonly FootprintCell[];
  readonly build: readonly FootprintCell[];
}

/** Per type and level; types are map input, so the memo cannot change a result. */
const byType = new WeakMap<ScriptLandscapeType, Map<number, PlacementBlockCells>>();

/** The cells a placement of `type` at `level` blocks: its rows up to that level, or the full-grown
 *  cells for a type that carries no rows. Shared and read-only; copy before storing in a component. */
export function placementBlockCells(type: ScriptLandscapeType, level: number): PlacementBlockCells {
  const areas = type.blockAreas;
  if (areas === undefined) return type;
  let levels = byType.get(type);
  if (levels === undefined) {
    levels = new Map();
    byType.set(type, levels);
  }
  let cells = levels.get(level);
  if (cells === undefined) {
    cells = { walk: levelBlockAreaCells(areas.walk, level), build: levelBlockAreaCells(areas.build, level) };
    levels.set(level, cells);
  }
  return cells;
}
