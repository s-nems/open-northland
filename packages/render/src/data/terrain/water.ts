import { TILE_HALF_H, TILE_HALF_W } from '../projection/index.js';
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

/** A cell's water value in [0, 1], the grid clamped at its edges. */
export type WaterCellFn = (col: number, row: number) => number;

/**
 * The per-node water inputs of a map's ground mesh: `wave` is the swell amplitude factor (0 = still
 * ground), `surface` the node cell's water fraction (the shading mask), `deep` its fraction drawn with
 * a deep-water pattern (0 on shallows and land).
 */
export interface WaterField {
  readonly wave: WaterNodeFn;
  readonly surface: WaterNodeFn;
  readonly deep: WaterNodeFn;
  /** {@link surface} by cell, for a per-frame reader that must not allocate a node's cell. */
  readonly surfaceCell: WaterCellFn;
}

const STILL: WaterNodeFn = () => 0;

/** Shared so land maps allocate nothing. */
export const NO_WATER: WaterField = { wave: STILL, surface: STILL, deep: STILL, surfaceCell: STILL };

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

/** A map's per-cell water fractions over each cell's two triangles: 1 = both, 0.5 = one, 0 = neither. */
export interface WaterCellFractions {
  /** Drawn with any water pattern. */
  readonly water: Float32Array;
  /** Drawn with a deep (non-shallow) water pattern. */
  readonly deep: Float32Array;
}

/** The per-cell water fractions of a map's ground lanes, or `undefined` when no cell draws water. */
export function waterCellFractions(
  ground: SceneGround | undefined,
  width: number,
  height: number,
): WaterCellFractions | undefined {
  if (ground === undefined || width <= 0 || height <= 0) return undefined;
  const waterPattern = ground.patterns.map((name) => (paintsWater(name) ? 1 : 0));
  const deepPattern = ground.patterns.map((name, i) =>
    waterPattern[i] === 1 && !SHALLOW_PATTERN_NAME.test(name) ? 1 : 0,
  );
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
  // A dictionary may name water no cell draws - still a land map.
  return anyWater ? { water, deep } : undefined;
}

export function makeWaterField(ground: SceneGround | undefined, width: number, height: number): WaterField {
  const fractions = waterCellFractions(ground, width, height);
  if (fractions === undefined) return NO_WATER;
  const { water, deep } = fractions;
  const cells = width * height;
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
  const cellValue =
    (values: Float32Array): WaterCellFn =>
    (col, row) => {
      const c = col < 0 ? 0 : col >= width ? width - 1 : col;
      const r = row < 0 ? 0 : row >= height ? height - 1 : row;
      return values[r * width + c] ?? 0;
    };
  const nodeValue = (atCell: WaterCellFn): WaterNodeFn => {
    return (hx, hy) => {
      const [col, row] = nodeCell(hx, hy);
      return atCell(col, row);
    };
  };
  const surfaceCell = cellValue(water);
  return {
    wave: nodeValue(cellValue(amp)),
    surface: nodeValue(surfaceCell),
    deep: nodeValue(cellValue(deep)),
    surfaceCell,
  };
}

/**
 * `field`'s water surface at world px (`x`, `y`) on the unlifted water plane, blended across the
 * staggered cell centres around it, so an overlay fading by it thins out over the last cell before a
 * shore instead of stepping.
 */
export function waterSurfaceAt(field: WaterField, x: number, y: number): number {
  const fy = y / TILE_HALF_H;
  const r0 = Math.floor(fy);
  const tr = fy - r0;
  return rowSurface(field, x, r0) * (1 - tr) + rowSurface(field, x, r0 + 1) * tr;
}

/** Blend of row `r`'s two cell centres either side of `x`; cell `c` of row `r` centres at
 *  `(2c + (r & 1)) * TILE_HALF_W`. */
function rowSurface(field: WaterField, x: number, r: number): number {
  const fc = (x / TILE_HALF_W - (r & 1)) / 2;
  const c0 = Math.floor(fc);
  const tc = fc - c0;
  return field.surfaceCell(c0, r) * (1 - tc) + field.surfaceCell(c0 + 1, r) * tc;
}
