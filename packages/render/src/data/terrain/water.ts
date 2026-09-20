import type { SceneGround } from '../scene/index.js';
import { clampedCellAt } from './cell-field.js';
import { nodeCell } from './tessellation.js';

/**
 * The water surface the ground shader animates and shades - an Open Northland enhancement; the
 * original's water is a static ground texture plus animated foam decor.
 *
 * The mask keys off the map's own ground-pattern names (`empa`/`empb` → `eapd`), the one signal
 * authoritative on every textured map. Not the `lmms` lane: probed on the owned copies it carries the
 * same bands across plain meadow on waterless maps, so keying off it would bob grass.
 */

/** A terrain-mesh node's water value in [0, 1]. */
export type WaterNodeFn = (hx: number, hy: number) => number;

/**
 * The per-node water inputs of a map's ground mesh: `wave` is the swell amplitude factor (0 = still
 * ground), `surface` the node cell's water fraction (the shading mask), `deep` its fraction drawn with
 * a deep-water pattern (0 on shallows and land).
 */
export interface WaterField {
  readonly wave: WaterNodeFn;
  readonly surface: WaterNodeFn;
  readonly deep: WaterNodeFn;
}

const STILL: WaterNodeFn = () => 0;

/** Shared so land maps allocate nothing. */
export const NO_WATER: WaterField = { wave: STILL, surface: STILL, deep: STILL };

/** A ground pattern drawing water surface, by `EditName` ('water 01', 'block water …',
 *  'block water shallow …' across the owned corpus). */
const WATER_PATTERN_NAME = /water/i;

/** The authored shallow-water family, keyed by `EditName` ('block water shallow …'): the map painter's
 *  own depth split, drawn with its lighter texture. Every other water pattern counts as deep. The name
 *  is the only signal a `SceneGround` carries; the `water bright` edit group the IR also records would
 *  additionally catch `water Bright 01`, which no shipped map's ground dictionary uses. */
const SHALLOW_PATTERN_NAME = /shallow/i;

/** Whether a ground pattern or transition overlay of this name paints water, so takes the water shading. */
export const paintsWater = (name: string): boolean => WATER_PATTERN_NAME.test(name);

export function makeWaterField(ground: SceneGround | undefined, width: number, height: number): WaterField {
  if (ground === undefined || width <= 0 || height <= 0) return NO_WATER;
  const waterPattern = ground.patterns.map((name) => (paintsWater(name) ? 1 : 0));
  const deepPattern = ground.patterns.map((name, i) =>
    waterPattern[i] === 1 && !SHALLOW_PATTERN_NAME.test(name) ? 1 : 0,
  );
  // Per-cell fractions over the cell's two triangles: 1 = both, 0.5 = one, 0 = neither.
  const cells = width * height;
  const water = new Float32Array(cells);
  const deep = new Float32Array(cells);
  let anyWater = false;
  for (let i = 0; i < cells; i++) {
    const a = ground.a[i] ?? -1;
    const b = ground.b[i] ?? -1;
    const w = ((waterPattern[a] ?? 0) + (waterPattern[b] ?? 0)) / 2;
    water[i] = w;
    deep[i] = ((deepPattern[a] ?? 0) + (deepPattern[b] ?? 0)) / 2;
    if (w > 0) anyWater = true;
  }
  if (!anyWater) return NO_WATER; // a dictionary may name water no cell draws - still a land map
  const at = clampedCellAt(water, width, height);
  // Node amplitude = the minimum water fraction over the node's 3×3 cell neighbourhood, so any node a
  // land triangle can reach stays exactly still and the coastline never warps. The shader's varying
  // interpolation ramps the band between them across one triangle.
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
  // Surface and depth take the node's own cell, like the brightness lane: the varying then fades each
  // across the coast triangle instead of stepping at the node.
  const nodeValue =
    (values: Float32Array): WaterNodeFn =>
    (hx, hy) => {
      const [col, row] = nodeCell(hx, hy);
      const c = col < 0 ? 0 : col >= width ? width - 1 : col;
      const r = row < 0 ? 0 : row >= height ? height - 1 : row;
      return values[r * width + c] ?? 0;
    };
  return { wave: nodeValue(amp), surface: nodeValue(water), deep: nodeValue(deep) };
}
