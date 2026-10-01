import type { SceneTerrain } from '../scene/terrain-scene.js';
import type { TerrainCells } from './minimap.js';
import { waterCellFractions } from './water.js';

/** The deposit families the minimap tints; the caller's content join decides which objects count. */
export const MINIMAP_DEPOSIT_KINDS = ['stone', 'clay', 'iron', 'gold'] as const;
export type MinimapDepositKind = (typeof MINIMAP_DEPOSIT_KINDS)[number];

/**
 * What the styled raster reads. Every lane is row-major, one value per cell; an absent or wrongly sized
 * lane is skipped. `water` and `deepWater` are cell fractions in [0, 1] (`waterCellFractions`),
 * `forest` and `depositDensity` densities in [0, 1], `depositKind` 0 for none or 1 + the index into
 * {@link MINIMAP_DEPOSIT_KINDS}, and `elevation` and `brightness` the decoded map's `lmhe` and `embr`.
 */
export interface MinimapScene extends TerrainCells {
  readonly colourOfCell: (cell: number, typeId: number) => number;
  readonly elevation?: ArrayLike<number>;
  readonly brightness?: ArrayLike<number>;
  readonly water?: ArrayLike<number>;
  readonly deepWater?: ArrayLike<number>;
  readonly forest?: ArrayLike<number>;
  readonly depositKind?: ArrayLike<number>;
  readonly depositDensity?: ArrayLike<number>;
}

/**
 * The scene a decoded map's terrain yields: its elevation and baked light, the water fractions of its
 * ground lanes, and the caller's object lanes when it has the content join to build them.
 */
export function minimapScene(
  terrain: SceneTerrain,
  colourOfCell: (cell: number, typeId: number) => number,
  objectLanes?: Pick<MinimapScene, 'forest' | 'depositKind' | 'depositDensity'>,
): MinimapScene {
  const water = waterCellFractions(terrain.ground, terrain.width, terrain.height);
  return {
    width: terrain.width,
    height: terrain.height,
    typeIds: terrain.typeIds,
    colourOfCell,
    ...(terrain.elevation !== undefined ? { elevation: terrain.elevation } : {}),
    ...(terrain.brightness !== undefined ? { brightness: terrain.brightness } : {}),
    ...(water !== undefined ? { water: water.water, deepWater: water.deep } : {}),
    ...objectLanes,
  };
}
