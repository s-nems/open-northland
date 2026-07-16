import { clampedCellAt } from './cell-field.js';
import type { SceneGround } from './scene/index.js';
import { nodeCell } from './terrain.js';

/**
 * The water-surface wave field — an OpenNorthland visual enhancement (the original's water is a
 * static ground texture plus animated foam decor). Each terrain-mesh node gets a wave amplitude
 * factor in [0, 1] the ground shader bobs/shimmers by (`gpu/shading.ts`).
 *
 * The water mask comes from the map's own ground-pattern NAMES (`empa`/`empb` → `eapd`, the lanes the
 * mesh already draws) — the one signal that is authoritative on every textured map. The `lmms` lane
 * is deliberately NOT used: it tracks water depth only on maps that have water (oasis_o_plenty:
 * band 7 = `block water`, 1..6 = `water shallow`) but carries the same 1..7 bands across plain meadow
 * on waterless maps (Tale_of_Six_Sons — probed on the owned copies), so keying off it would bob grass.
 *
 * Amplitude is 1 only where a node's whole 3×3 cell neighbourhood is water and 0 on any node a land
 * triangle can reach, so the coastline never warps; the shader's varying interpolation ramps the band
 * between them across one triangle.
 */

/** A terrain-mesh node's wave amplitude factor in [0, 1] (0 = still ground). */
export type NodeWaveFn = (hx: number, hy: number) => number;

/** The still field — no ground lanes / no water. Shared so land maps allocate nothing. */
export const NO_WAVE: NodeWaveFn = () => 0;

/** A ground pattern drawing water surface, by `EditName` ('water 01', 'block water …',
 *  'block water shallow …' across the owned corpus). */
const WATER_PATTERN_NAME = /water/i;

/**
 * Build the per-node wave field from a decoded map's ground lanes, or {@link NO_WAVE} when the map
 * has no ground layer or no water-patterned cell at all. Pure; built once per map.
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
  if (!anyWater) return NO_WAVE; // a dictionary may name water no cell draws — still a land map
  const at = clampedCellAt(water, width, height);
  // Node amplitude = the minimum water fraction over the node's 3×3 cell neighbourhood, so any node
  // shared with a land triangle stays exactly still and the swell lives offshore.
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
