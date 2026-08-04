/**
 * The world metric of the staggered-raster lattice, the sim-side twin of the measured projection.
 * Source basis: projection, measured pitch 68 px per column step by 38 px per row step, odd rows shifted
 * half a cell right. Movement distances must use that geometry; in naive grid units a north-south walk
 * reads about 25% slower than an east-west one and the pathfinder prices lattice edges wrongly.
 *
 * Everything here is in column units, so one full cell width (68 px) is ONE. A row step is 38/68 = 19/34
 * of a unit down and exactly half a unit sideways, making a row-crossing edge sqrt(1/4 + (19/34)^2),
 * about 0.75 of a horizontal one (51 px against 68 px). Pure fixed-point through the sanctioned isqrt,
 * since the metric feeds game state and must be byte-deterministic.
 */
import { type Fixed, fx, ONE } from '../core/fixed.js';

/** Half a column step (34 px): the sideways shift one row step carries under the stagger, and the
 *  length of one E/W navigation step. */
export const HALF_COLUMN: Fixed = fx.div(ONE, fx.fromInt(2));

/**
 * Half a row step, the N/S pitch of the navigation lattice: 19 px over the 68 px column step, 19/68
 * exactly. Minted as its own primitive rather than `ROW_STEP/2`, whose truncation would leave
 * `2*HALF_ROW` short of `ROW_STEP` by one ulp and break the exactness argument in `nodeLatticeDistance`,
 * which composes its per-half-row term from this same integer.
 */
export const HALF_ROW: Fixed = fx.div(fx.fromInt(19), fx.fromInt(68));

/**
 * The vertical world extent of one row step in column units: the measured 38 px row step over the 68 px
 * column step, 19/34 exactly. The render's `TILE_HALF_H / (2*TILE_HALF_W)` is the same ratio in pixels.
 */
export const ROW_STEP: Fixed = fx.div(fx.fromInt(19), fx.fromInt(34));

/**
 * The world length of a row-crossing lattice edge, half a column sideways and one row up or down:
 * sqrt(1/4 + ROW_STEP^2), about 0.7498 of ONE, the measured 51 px over the 68 px column step. The
 * truncated isqrt sits below the true value, so a heuristic built on it stays admissible.
 */
export const DIAGONAL_STEP: Fixed = fx.isqrt(
  fx.add(fx.mul(HALF_COLUMN, HALF_COLUMN), fx.mul(ROW_STEP, ROW_STEP)),
);

/** The stagger's row period. */
const TWO: Fixed = fx.fromInt(2);

/**
 * The stagger's sideways shift in column units at a possibly fractional row: 0 on even rows,
 * {@link HALF_COLUMN} on odd rows, linear between. This is the triangle wave the render's `tileToScreen`
 * interpolates, so a walking entity's sim position and its drawn position agree. Negative rows are safe.
 */
export function staggerShift(row: Fixed): Fixed {
  const m = fx.mod(fx.add(fx.mod(row, TWO), TWO), TWO); // row's place in the 2-row cycle, in [0, 2)
  const wave = fx.sub(ONE, fx.abs(fx.sub(ONE, m))); // 0 at even rows, ONE at odd, linear between
  return fx.div(wave, TWO);
}

/** A position's world X in column units: its column plus the stagger shift of its fractional row. */
export function worldX(x: Fixed, y: Fixed): Fixed {
  return fx.add(x, staggerShift(y));
}

/**
 * The straight-line world distance between two grid positions in column units, Euclidean over the world
 * X delta and the row delta scaled by ROW_STEP. Exact within one stagger half-period, which covers every
 * lattice-edge leg; a longer leg crossing a parity kink under-reads by a few percent, so the mover paces
 * that one leg marginally fast, still deterministically.
 *
 * Span bound: the squared deltas leave the 2^53-exact range once a span exceeds about 1400 columns, so
 * this is a leg-length metric, not a map-scale distance query.
 */
export function worldDistance(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): Fixed {
  const dwx = fx.sub(worldX(bx, by), worldX(ax, ay));
  const dwy = fx.mul(fx.sub(by, ay), ROW_STEP);
  return fx.isqrt(fx.add(fx.mul(dwx, dwx), fx.mul(dwy, dwy)));
}
