import { clamp, clamp01 } from '../math.js';
import { TILE_HALF_H, TILE_HALF_W } from '../projection/iso.js';
import { BRIGHTNESS_NEUTRAL } from './brightness.js';
import { elevationLiftPerUnit } from './elevation.js';
import { boxBlur, laneOf, staggerBlur } from './minimap-grid.js';
import type { MinimapScene } from './minimap-scene.js';

/**
 * The minimap's land light per cell: hillshaded relief at three scales, occlusion in valleys and
 * hollows, ridge highlights and a height gain from the elevation lane, accented by the baked `embr`
 * plane. Named approximations tuned by eye.
 */

/** Light direction (+x right, +y down, +z up out of the map), pointing at the light: upper left. */
export const MINIMAP_LIGHT = { x: -0.62, y: -0.62, z: 0.48 } as const;

/** One hillshade scale: the slope exaggeration (true slopes are too shallow to read at minimap scale)
 *  and how much of the full Lambert contrast it keeps. Each scale shades a blurred height, so per-cell
 *  height jitter does not crinkle flat ground or band along the mesh. */
interface ReliefScale {
  readonly exaggeration: number;
  readonly strength: number;
}
/** Fine relief shades the height after one stagger blur; mid relief shades the occlusion's near mean
 *  after a stagger blur that rounds off the box's corners. */
const FINE_RELIEF: ReliefScale = { exaggeration: 10, strength: 0.42 };
const MID_RELIEF: ReliefScale = { exaggeration: 16, strength: 0.4 };
/** The fine scale's clamp around flat (1), so a cliff cell does not punch a hole in the picture. */
const FINE_RELIEF_MIN = 0.62;
const FINE_RELIEF_MAX = 1.3;
/** How much of the fine relief a full canopy hides: from above, a closed stand smooths out the ground's
 *  small folds, which would otherwise mottle the forest into camouflage. */
const CANOPY_FINE_DAMP = 0.7;
/** The broad massing light: the same Lambert term over a box-blurred height. */
const MASSING_RADIUS_COLS = 4;
const MASSING_RELIEF: ReliefScale = { exaggeration: 20, strength: 0.5 };

/** Occlusion and ridge light: how far a cell sits below (hollow) or above (ridge) the mean height
 *  around it, over a near and a far box radius in columns; the height difference for the full term. */
const NEAR_RADIUS_COLS = 1;
const FAR_RADIUS_COLS = 5;
const NEAR_FULL_DEPTH = 14;
const FAR_FULL_DEPTH = 40;
const HOLLOW_SHADE = 0.22;
const RIDGE_LIGHT = 0.12;
/** High ground reads a touch lighter: brightness gain per elevation unit above the map mean. */
const HEIGHT_GAIN_PER_UNIT = 0.0016;
const HEIGHT_GAIN_MAX = 0.16;

/** How much of the baked `embr` plane accents the interior, clamped so its per-cell noise never dominates. */
const BAKED_LIGHT_WEIGHT = 0.3;
const BAKED_ACCENT_MIN = 0.82;
const BAKED_ACCENT_MAX = 1.18;
/** The bake's fade-to-black map border, kept as its own term: values below this share of neutral read as
 *  border, darkened by up to {@link BORDER_SHADE}. */
const BORDER_BAKED_LEVEL = 0.4;
const BORDER_SHADE = 0.4;

/** A cell's land light before clipping, and the map-border fade applied after it. */
export interface CellLight {
  /** Relief, massing, occlusion, ridge light, height gain and the bake's accent; flat ground = 1. */
  readonly light: Float32Array;
  /** 1 inside the map, falling toward the baked border. */
  readonly edge: Float32Array;
}

/**
 * Per-cell land light. `canopyHeight` (elevation units per cell, optional) raises wooded cells for the
 * fine relief only, so a forest edge lights up on the sun side and falls into shade on the far side;
 * `canopyCover` (0..1 per cell, optional) damps the fine relief under the stand.
 */
export function cellLight(
  scene: MinimapScene,
  canopyHeight?: ArrayLike<number>,
  canopyCover?: ArrayLike<number>,
): CellLight {
  const { width, height } = scene;
  const cells = width * height;
  const elevation = laneOf(scene.elevation, cells);
  const brightness = laneOf(scene.brightness, cells);
  const canopy = laneOf(canopyHeight, cells);
  const light = new Float32Array(cells).fill(1);
  const edge = new Float32Array(cells).fill(1);
  if (elevation !== undefined || canopy !== undefined) {
    const ground = new Float32Array(cells);
    for (let i = 0; i < cells; i++) ground[i] = elevation?.[i] ?? 0;
    const surface = new Float32Array(cells);
    for (let i = 0; i < cells; i++) surface[i] = (ground[i] ?? 0) + (canopy?.[i] ?? 0);
    const near = boxBlur(ground, width, height, NEAR_RADIUS_COLS);
    const fine = lambert(staggerBlur(surface, width, height), width, height, FINE_RELIEF);
    const mid = lambert(staggerBlur(near, width, height), width, height, MID_RELIEF);
    const massing = lambert(
      boxBlur(ground, width, height, MASSING_RADIUS_COLS),
      width,
      height,
      MASSING_RELIEF,
    );
    const far = boxBlur(ground, width, height, FAR_RADIUS_COLS);
    let mean = 0;
    for (let i = 0; i < cells; i++) mean += ground[i] ?? 0;
    mean /= cells;
    for (let i = 0; i < cells; i++) {
      const e = ground[i] ?? 0;
      const fineLight = clamp(fine[i] ?? 1, FINE_RELIEF_MIN, FINE_RELIEF_MAX);
      const damp = CANOPY_FINE_DAMP * clamp01(canopyCover?.[i] ?? 0);
      const relief = (fineLight + (1 - fineLight) * damp) * (mid[i] ?? 1) * (massing[i] ?? 1);
      const rise = ((e - (near[i] ?? e)) / NEAR_FULL_DEPTH + (e - (far[i] ?? e)) / FAR_FULL_DEPTH) / 2;
      const occlusion = rise < 0 ? 1 - HOLLOW_SHADE * clamp01(-rise) : 1 + RIDGE_LIGHT * clamp01(rise);
      const gain = 1 + clamp((e - mean) * HEIGHT_GAIN_PER_UNIT, -HEIGHT_GAIN_MAX, HEIGHT_GAIN_MAX);
      light[i] = relief * occlusion * gain;
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
 * Lambert light relative to flat ground per cell, scaled to the relief's strength. The height gradient
 * is the least-squares fit over the six touching cells: the row neighbours `2·TILE_HALF_W` away and the
 * four diagonal ones at `(±TILE_HALF_W, ±TILE_HALF_H)`, so odd and even rows share one smooth field.
 */
function lambert(
  heights: ArrayLike<number>,
  width: number,
  height: number,
  scale: ReliefScale,
): Float32Array {
  const out = new Float32Array(width * height);
  const lift = elevationLiftPerUnit() * scale.exaggeration;
  const len = Math.hypot(MINIMAP_LIGHT.x, MINIMAP_LIGHT.y, MINIMAP_LIGHT.z);
  const lx = MINIMAP_LIGHT.x / len;
  const ly = MINIMAP_LIGHT.y / len;
  const lz = MINIMAP_LIGHT.z / len;
  // Σdx² over the six neighbours = 2·(2·HW)² + 4·HW², Σdy² = 4·HH².
  const sumDx2 = 12 * TILE_HALF_W * TILE_HALF_W;
  const sumDy2 = 4 * TILE_HALF_H * TILE_HALF_H;
  const lastCol = width - 1;
  const strength = scale.strength;
  for (let row = 0; row < height; row++) {
    const left = -1 + (row & 1);
    const here = row * width;
    const up = clamp(row - 1, 0, height - 1) * width;
    const down = clamp(row + 1, 0, height - 1) * width;
    for (let col = 0; col < width; col++) {
      const l = col + left < 0 ? 0 : col + left;
      const r = col + left + 1 > lastCol ? lastCol : col + left + 1;
      const nw = heights[up + l] ?? 0;
      const ne = heights[up + r] ?? 0;
      const sw = heights[down + l] ?? 0;
      const se = heights[down + r] ?? 0;
      const east =
        (heights[here + (col < lastCol ? col + 1 : lastCol)] ?? 0) -
        (heights[here + (col > 0 ? col - 1 : 0)] ?? 0);
      const gx = ((2 * TILE_HALF_W * east + TILE_HALF_W * (ne + se - nw - sw)) * lift) / sumDx2;
      const gy = (TILE_HALF_H * (sw + se - nw - ne) * lift) / sumDy2;
      // Height rises toward the viewer's "up", so the surface normal is (-gx, -gy, 1).
      const dot = (-gx * lx - gy * ly + lz) / Math.sqrt(gx * gx + gy * gy + 1);
      out[here + col] = 1 + strength * (Math.max(0, dot) / lz - 1);
    }
  }
  return out;
}
