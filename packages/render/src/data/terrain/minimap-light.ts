import { clamp, clamp01 } from '../math.js';
import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';
import { BRIGHTNESS_NEUTRAL } from './brightness.js';
import { elevationLiftPerUnit } from './elevation.js';
import { boxBlur, laneOf, staggerBlur } from './minimap-grid.js';
import type { MinimapScene } from './minimap-scene.js';

/**
 * The minimap's land light per cell: hillshaded relief, broad massing, valley shade and a height gain
 * from the elevation lane, accented by the baked `embr` plane. Named approximations tuned by eye.
 */

/** Light direction (+x right, +y down, +z up out of the map), pointing at the light: upper left. */
const LIGHT = { x: -0.62, y: -0.62, z: 0.48 } as const;
/** Relief exaggeration: the true slopes are too shallow to read at minimap scale. The relief reads a
 *  blurred height, so per-cell height jitter does not crinkle flat ground or band along the mesh. */
const RELIEF_EXAGGERATION = 9;
const RELIEF_BLUR_PASSES = 2;
/** How much of the full Lambert contrast the relief keeps, and its clamp around flat (1). */
const RELIEF_STRENGTH = 0.5;
const RELIEF_MIN = 0.7;
const RELIEF_MAX = 1.25;
/** The broad massing light: the same Lambert term over the valley-blurred height. */
const MASSING_EXAGGERATION = 16;
const MASSING_STRENGTH = 0.45;

/** Valley shade: blur radius in columns (rows use the pitch ratio), height depth for full shade. */
const VALLEY_RADIUS_COLS = 4;
const VALLEY_FULL_DEPTH = 40;
const VALLEY_SHADE = 0.16;
/** High ground reads a touch lighter: brightness gain per elevation unit above the map mean. */
const HEIGHT_GAIN_PER_UNIT = 0.0016;
const HEIGHT_GAIN_MAX = 0.16;

/** How much of the baked `embr` plane accents the interior, clamped so its per-cell noise never dominates. */
const BAKED_LIGHT_WEIGHT = 0.35;
const BAKED_ACCENT_MIN = 0.8;
const BAKED_ACCENT_MAX = 1.2;
/** The bake's fade-to-black map border, kept as its own term: values below this share of neutral read as
 *  border, darkened by up to {@link BORDER_SHADE}. */
const BORDER_BAKED_LEVEL = 0.4;
const BORDER_SHADE = 0.4;

/** A cell's land light before clipping, and the map-border fade applied after it. */
export interface CellLight {
  /** Relief, massing, valley shade, height gain and the bake's interior accent; flat ground = 1. */
  readonly light: Float32Array;
  /** 1 inside the map, falling toward the baked border. */
  readonly edge: Float32Array;
}

/**
 * Per-cell land light. `reliefScale` in (0, 1] scales the fine relief: at a large pixel pitch the
 * per-cell relief stops reading as texture and reads as noise, while massing and valley shade stay.
 */
export function cellLight(scene: MinimapScene, reliefScale: number): CellLight {
  const { width, height } = scene;
  const cells = width * height;
  const elevation = laneOf(scene.elevation, cells);
  const brightness = laneOf(scene.brightness, cells);
  const light = new Float32Array(cells).fill(1);
  const edge = new Float32Array(cells).fill(1);
  if (elevation !== undefined) {
    const blurred = boxBlur(elevation, width, height, VALLEY_RADIUS_COLS);
    let mean = 0;
    for (let i = 0; i < cells; i++) mean += elevation[i] ?? 0;
    mean /= cells;
    let smoothed: ArrayLike<number> = elevation;
    for (let pass = 0; pass < RELIEF_BLUR_PASSES; pass++) smoothed = staggerBlur(smoothed, width, height);
    const relief = lambert(smoothed, width, height, RELIEF_EXAGGERATION);
    const massing = lambert(blurred, width, height, MASSING_EXAGGERATION);
    const reliefStrength = RELIEF_STRENGTH * reliefScale;
    for (let i = 0; i < cells; i++) {
      const e = elevation[i] ?? 0;
      const fine = clamp(1 + reliefStrength * ((relief[i] ?? 1) - 1), RELIEF_MIN, RELIEF_MAX);
      const broad = 1 + MASSING_STRENGTH * ((massing[i] ?? 1) - 1);
      const valley = 1 - VALLEY_SHADE * clamp01(((blurred[i] ?? 0) - e) / VALLEY_FULL_DEPTH);
      const gain = 1 + clamp((e - mean) * HEIGHT_GAIN_PER_UNIT, -HEIGHT_GAIN_MAX, HEIGHT_GAIN_MAX);
      light[i] = fine * broad * valley * gain;
    }
  }
  if (brightness !== undefined) {
    for (let i = 0; i < cells; i++) {
      const baked = (brightness[i] ?? BRIGHTNESS_NEUTRAL) / BRIGHTNESS_NEUTRAL;
      const accent = clamp(1 + BAKED_LIGHT_WEIGHT * (baked - 1), BAKED_ACCENT_MIN, BAKED_ACCENT_MAX);
      light[i] = (light[i] ?? 1) * accent;
      edge[i] = 1 - BORDER_SHADE * (1 - clamp01(baked / BORDER_BAKED_LEVEL));
    }
  }
  return { light, edge };
}

/**
 * Lambert light relative to flat ground per cell. The height gradient is the least-squares fit over the
 * six touching cells: the row neighbours `2·TILE_HALF_W` away and the four diagonal ones at
 * `(±TILE_HALF_W, ±TILE_HALF_H)`, so odd and even rows share one smooth field.
 */
function lambert(
  heights: ArrayLike<number>,
  width: number,
  height: number,
  exaggeration: number,
): Float32Array {
  const out = new Float32Array(width * height);
  const lift = elevationLiftPerUnit() * exaggeration;
  const len = Math.hypot(LIGHT.x, LIGHT.y, LIGHT.z);
  const lx = LIGHT.x / len;
  const ly = LIGHT.y / len;
  const lz = LIGHT.z / len;
  // Σdx² over the six neighbours = 2·(2·HW)² + 4·HW², Σdy² = 4·HH².
  const sumDx2 = 12 * TILE_HALF_W * TILE_HALF_W;
  const sumDy2 = 4 * TILE_HALF_H * TILE_HALF_H;
  const at = (col: number, row: number): number =>
    heights[clamp(row, 0, height - 1) * width + clamp(col, 0, width - 1)] ?? 0;
  for (let row = 0; row < height; row++) {
    const left = -1 + (row & 1);
    for (let col = 0; col < width; col++) {
      const nw = at(col + left, row - 1);
      const ne = at(col + left + 1, row - 1);
      const sw = at(col + left, row + 1);
      const se = at(col + left + 1, row + 1);
      const east = at(col + 1, row) - at(col - 1, row);
      const gx = ((2 * TILE_HALF_W * east + TILE_HALF_W * (ne + se - nw - sw)) * lift) / sumDx2;
      const gy = (TILE_HALF_H * (sw + se - nw - ne) * lift) / sumDy2;
      // Height rises toward the viewer's "up", so the surface normal is (-gx, -gy, 1).
      const dot = (-gx * lx - gy * ly + lz) / Math.hypot(gx, gy, 1);
      out[row * width + col] = Math.max(0, dot) / lz;
    }
  }
  return out;
}
