/**
 * The world metric of the staggered-raster lattice, the sim-side twin of the measured projection.
 * Source basis: projection, measured pitch 68 px per column step by 38 px per row step, odd rows shifted
 * half a cell right.
 *
 * Everything here is in column units, so one full cell width (68 px) is ONE. Pure fixed-point through
 * the sanctioned isqrt, since the metric feeds game state and must be byte-deterministic.
 */
import { type Fixed, fx, ONE } from '../core/fixed.js';

/** The measured column step in screen pixels: what a pixel offset the content authors (a house program's
 *  walk point) divides by to land in column units. */
export const COLUMN_PX = 68;

/** Half a column step (34 px): the sideways shift one row step carries under the stagger, and the
 *  length of one E/W navigation step. */
export const HALF_COLUMN: Fixed = fx.div(ONE, fx.fromInt(2));

/** A quarter column step (17 px): how far an odd node row sits east of the even rows around it. */
export const QUARTER_COLUMN: Fixed = fx.div(ONE, fx.fromInt(4));

/** Half a row step, the N/S pitch of the navigation lattice: 19 px over the 68 px column step, 19/68
 *  exactly. Not interchangeable with {@link ROW_STEP}, the full-row extent: `2*HALF_ROW` truncates an ulp
 *  under it. */
export const HALF_ROW: Fixed = fx.div(fx.fromInt(19), fx.fromInt(68));

/**
 * The vertical world extent of one row step in column units: the measured 38 px row step over the 68 px
 * column step, 19/34 exactly. The render's `TILE_HALF_H / (2*TILE_HALF_W)` is the same ratio in pixels.
 */
export const ROW_STEP: Fixed = fx.div(fx.fromInt(19), fx.fromInt(34));

/**
 * The world length of each of the four row-crossing lattice edges, a quarter column sideways and half a
 * row up or down: sqrt(QUARTER_COLUMN^2 + HALF_ROW^2), about 0.3749 of ONE, 25.5 px. Original behavior:
 * odd node rows sit a quarter column east, so the four edges are one length. The truncated isqrt sits
 * below the true value, so a heuristic built on it stays admissible.
 */
export const ROW_EDGE: Fixed = fx.isqrt(
  fx.add(fx.mul(QUARTER_COLUMN, QUARTER_COLUMN), fx.mul(HALF_ROW, HALF_ROW)),
);

/** The stagger's row period. */
const TWO: Fixed = fx.fromInt(2);

/**
 * The stagger's sideways shift in column units at a possibly fractional row: 0 on even rows,
 * {@link HALF_COLUMN} on odd rows, linear between. This is the triangle wave the render's `tileToScreen`
 * interpolates, so a walking entity's sim position and its drawn position agree. Negative rows are safe.
 */
export function staggerShift(row: Fixed): Fixed {
  // `fx.wrap(row, TWO)` inlined: the low bits of row's two's complement, in [0, TWO) for negative rows
  // too. The wave is a non-negative int32, so `>> 1` is exactly `fx.div(wave, TWO)`. Branch-free, as a
  // fractional row's parity half is unpredictable.
  const m = row & (TWO - 1);
  return ((ONE - Math.abs(m - ONE)) >> 1) as Fixed;
}

/** A position's world X in column units: its column plus the stagger shift of its fractional row. */
export function worldX(x: Fixed, y: Fixed): Fixed {
  return fx.add(x, staggerShift(y));
}

/**
 * The straight-line world distance between two grid positions in column units, Euclidean over the world
 * X delta and the row delta scaled by ROW_STEP. This is the straight endpoint distance even when the
 * segment crosses a stagger-parity cusp; movement interpolates in this same world space.
 *
 * Span bound: the squared deltas leave the 2^53-exact range once a span exceeds about 1400 columns, so
 * this is a leg-length metric, not a map-scale distance query.
 */
export function worldDistance(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): Fixed {
  return worldDistanceOfDelta(fx.sub(worldX(bx, by), worldX(ax, ay)), fx.sub(by, ay));
}

/** {@link worldDistance} from a world X delta and a grid row delta, for a caller that already holds both. */
export function worldDistanceOfDelta(dwx: Fixed, dRow: Fixed): Fixed {
  const dwy = fx.mul(dRow, ROW_STEP);
  return fx.isqrt(fx.add(fx.mul(dwx, dwx), fx.mul(dwy, dwy)));
}
