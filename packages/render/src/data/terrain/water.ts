import type { SceneGround } from '../scene/index.js';
import { clampedCellAt } from './cell-field.js';
import { nodeCell } from './tessellation.js';

/**
 * The water-surface wave field - an Open Northland enhancement; the original's water is a static ground
 * texture plus animated foam decor. Each terrain-mesh node gets a wave amplitude the ground shader bobs
 * by (`gpu/shading.ts`).
 *
 * The mask comes from the map's own ground-pattern names (`empa`/`empb` → `eapd`, the lanes the mesh
 * already draws), the one signal authoritative on every textured map. The `lmms` lane is deliberately
 * not used: it tracks water depth on maps that have water (oasis_o_plenty: band 7 = `block water`,
 * 1..6 = `water shallow`) but carries the same 1..7 bands across plain meadow on waterless maps
 * (Tale_of_Six_Sons, probed on the owned copies), so keying off it would bob grass.
 */

/** A terrain-mesh node's wave amplitude factor in [0, 1] (0 = still ground). */
export type NodeWaveFn = (hx: number, hy: number) => number;

/** The still field - no ground lanes / no water. Shared so land maps allocate nothing. */
export const NO_WAVE: NodeWaveFn = () => 0;

/** A ground pattern drawing water surface, by `EditName` ('water 01', 'block water …',
 *  'block water shallow …' across the owned corpus). */
const WATER_PATTERN_NAME = /water/i;

/**
 * Build the per-node wave field from a decoded map's ground lanes, or {@link NO_WAVE} when the map has
 * no ground layer or no water-patterned cell at all.
 */
export function makeWaveField(ground: SceneGround | undefined, width: number, height: number): NodeWaveFn {
  if (ground === undefined || width <= 0 || height <= 0) return NO_WAVE;
  const waterPattern = ground.patterns.map((name) => (WATER_PATTERN_NAME.test(name) ? 1 : 0));
  // Per-cell water fraction: 1 = both triangles water, 0.5 = one, 0 = land.
  const cells = width * height;
  const water = new Float32Array(cells);
  let anyWater = false;
  for (let i = 0; i < cells; i++) {
    const w = ((waterPattern[ground.a[i] ?? -1] ?? 0) + (waterPattern[ground.b[i] ?? -1] ?? 0)) / 2;
    water[i] = w;
    if (w > 0) anyWater = true;
  }
  if (!anyWater) return NO_WAVE; // a dictionary may name water no cell draws - still a land map
  const at = clampedCellAt(water, width, height);
  // Node amplitude = the minimum water fraction over the node's 3×3 cell neighbourhood, so any node a
  // land triangle can reach stays exactly still, the coastline never warps, and the swell lives
  // offshore. The shader's varying interpolation ramps the band between them across one triangle.
  const amp = new Float32Array(cells);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      let min = 1;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const v = at(col + dc, row + dr);
          if (v < min) min = v;
        }
      }
      amp[row * width + col] = min;
    }
  }
  return (hx: number, hy: number): number => {
    const [col, row] = nodeCell(hx, hy);
    const c = col < 0 ? 0 : col >= width ? width - 1 : col;
    const r = row < 0 ? 0 : row >= height ? height - 1 : row;
    return amp[r * width + c] ?? 0;
  };
}
