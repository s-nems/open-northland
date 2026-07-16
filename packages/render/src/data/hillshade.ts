import { BRIGHTNESS_NEUTRAL } from './brightness.js';
import { clampedCellAt } from './cell-field.js';
import { elevationLiftPerUnit } from './elevation.js';
import { TILE_HALF_H, TILE_HALF_W } from './iso.js';

/**
 * Slope hillshading computed from the map's elevation lane — an OpenNorthland visual enhancement, not
 * an original mechanism (the original's slope light is pre-baked into `embr`; `data/brightness.ts`).
 * A fixed north-west light (matching the direction the baked shadow art implies) shades each cell by
 * its elevation gradient, and the result composes with the shading lane two ways:
 *
 *  - **no `embr` lane** (synthetic grids, foreign maps): the hillshade IS the lane, so hills stop
 *    rendering flat-lit — a full-strength fallback around the neutral value;
 *  - **`embr` present**: the baked plane already carries the original's slope light, so the hillshade
 *    only *accents* it at {@link HILLSHADE_ENHANCE} strength (a subtle relief boost, not a second
 *    competing light model).
 *
 * Everything here is a named approximation: the light direction, the slope exaggeration and the
 * enhance strength are tuned constants awaiting a human pass, not measured values.
 */

/**
 * The fixed light direction (screen space: +x right, +y down, +z out of the ground plane), pointing
 * from the surface toward the light — upper-left, consistent with the baked cast-shadow art. Not
 * normalized here; {@link composeShadingLane} normalizes once.
 */
const HILLSHADE_LIGHT = { x: -0.6, y: -0.45, z: 0.7 } as const;

/**
 * Multiplier on the geometric slope before shading. The true projected slopes are shallow (a steep
 * 8-unit/cell rise is only ~0.14 px/px), which would shade invisibly; the exaggeration lifts relief
 * into the readable range. Tunable by eye.
 */
const SLOPE_EXAGGERATION = 8;

/** How strongly the hillshade accents a map that already carries the baked `embr` plane (0 = off,
 *  1 = full hillshade on top of the bake). Kept low — the bake is the faithful signal. */
const HILLSHADE_ENHANCE = 0.35;

/** Clamp of the relative hillshade multiplier (flat = 1), keeping extreme synthetic slopes readable. */
const HILLSHADE_MIN = 0.55;
const HILLSHADE_MAX = 1.45;

/**
 * Compose the per-cell shading lane the ground (and the anchored sprites) multiply by: the decoded
 * `embr` lane accented by elevation hillshade, or pure hillshade when the map has no `embr`, or the
 * inputs unchanged when there is no elevation to shade from. Returns a row-major u8-range lane
 * (neutral {@link BRIGHTNESS_NEUTRAL}) or `undefined` when there is nothing to shade with at all.
 * Pure — built once per map.
 */
export function composeShadingLane(
  brightness: readonly number[] | undefined,
  elevation: readonly number[] | undefined,
  width: number,
  height: number,
): readonly number[] | undefined {
  const cells = width * height;
  if (elevation === undefined || elevation.length !== cells || cells === 0) return brightness;
  const relative = hillshadeField(elevation, width, height);
  if (relative === null) return brightness; // flat map — nothing to shade from
  const out = new Array<number>(cells);
  if (brightness === undefined || brightness.length !== cells) {
    for (let i = 0; i < cells; i++) {
      out[i] = clampByte(BRIGHTNESS_NEUTRAL * (relative[i] ?? 1));
    }
    return out;
  }
  for (let i = 0; i < cells; i++) {
    const accent = 1 + HILLSHADE_ENHANCE * ((relative[i] ?? 1) - 1);
    out[i] = clampByte((brightness[i] ?? BRIGHTNESS_NEUTRAL) * accent);
  }
  return out;
}

/** Round + clamp a shading value into the lane's byte range. */
function clampByte(v: number): number {
  const r = Math.round(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

/**
 * The relative hillshade multiplier per cell (flat ground = 1, lit slope > 1, shadowed slope < 1),
 * clamped to [{@link HILLSHADE_MIN}, {@link HILLSHADE_MAX}] — or `null` when the lane is entirely
 * flat (no relief to shade). Central-difference gradient in world px (the same lift-per-unit the
 * mesh warps by, over the projected cell spacing), Lambert against {@link HILLSHADE_LIGHT},
 * normalized so flat ground is exactly neutral.
 */
function hillshadeField(
  elevation: readonly number[],
  width: number,
  height: number,
): readonly number[] | null {
  const liftPerUnit = elevationLiftPerUnit();
  // World px per elevation unit over world px per neighbouring cell — the projected slope, exaggerated.
  const slopeX = (liftPerUnit / (2 * TILE_HALF_W)) * SLOPE_EXAGGERATION;
  const slopeY = (liftPerUnit / (2 * TILE_HALF_H)) * SLOPE_EXAGGERATION;
  const lightLen = Math.hypot(HILLSHADE_LIGHT.x, HILLSHADE_LIGHT.y, HILLSHADE_LIGHT.z);
  const lx = HILLSHADE_LIGHT.x / lightLen;
  const ly = HILLSHADE_LIGHT.y / lightLen;
  const lz = HILLSHADE_LIGHT.z / lightLen;
  const at = clampedCellAt(elevation, width, height);
  const out = new Array<number>(width * height);
  let anySlope = false;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const gx = ((at(col + 1, row) - at(col - 1, row)) / 2) * slopeX;
      const gy = ((at(col, row + 1) - at(col, row - 1)) / 2) * slopeY;
      if (gx !== 0 || gy !== 0) anySlope = true;
      // Surface normal of z = -lift (screen y grows downward, lift subtracts): n = (-gx, -gy, 1).
      const invLen = 1 / Math.hypot(gx, gy, 1);
      const dot = (-gx * lx - gy * ly + lz) * invLen;
      // Relative to flat ground (n = +z, dot = lz), so flat cells stay exactly neutral.
      const relative = Math.max(0, dot) / lz;
      out[row * width + col] = Math.min(HILLSHADE_MAX, Math.max(HILLSHADE_MIN, relative));
    }
  }
  return anySlope ? out : null;
}
