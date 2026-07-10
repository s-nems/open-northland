/**
 * The WORLD METRIC of the staggered-raster lattice — the sim-side twin of the measured projection
 * (source basis "projection"; the render half lives in `render`'s `iso.ts`).
 *
 * The original's map is NOT a square grid: cells sit on a STAGGERED raster (odd rows shifted half a
 * cell right), with the measured pitch **68 px per column step × 38 px per row step**. Distances the
 * sim reasons about for MOVEMENT (how long a step is, hence how fast a walk covers it on screen) must
 * use that geometry, not naive grid units — a grid-space metric makes a north–south walk read ~25%
 * slower than an east–west one and prices the lattice's edges wrongly for the pathfinder (the old
 * octile costs were the root of the zigzag routes; source basis "Movement on the staggered
 * lattice").
 *
 * Everything here is expressed in COLUMN UNITS: one full cell width (a column step, 68 px) = ONE.
 * A row step is then 38/68 = 19/34 of a unit down and exactly half a unit sideways (the stagger), so
 * the four row-crossing lattice edges have length √(½² + (19/34)²) ≈ **0.75·ONE — the measured pitch
 * makes a diagonal edge almost exactly ¾ of a horizontal one** (51 px vs 68 px), which is why these
 * constants divide so cleanly. Pure fixed-point (the sanctioned isqrt), no floats — the metric feeds
 * game state, so it must be byte-deterministic.
 */
import { type Fixed, ONE, fx } from '../core/fixed.js';

/** Half a column step — the sideways shift one row step carries under the stagger, and the E/W
 *  pitch of the half-cell navigation lattice (34 px): one E/W nav step covers exactly this. */
export const HALF_COLUMN: Fixed = fx.div(ONE, fx.fromInt(2));

/**
 * Half a ROW step — the N/S pitch of the half-cell navigation lattice (19 px over the 68 px column
 * step, 19/68 exactly). Minted as its own primitive (NOT `ROW_STEP/2`, whose truncation would leave
 * `2·HALF_ROW ≠ ROW_STEP` by one ulp): the N/S nav edge costs exactly this, and the pathfinding
 * heuristic composes its per-half-row term from the SAME integer, so the exactness argument in
 * `nodeLatticeDistance` holds by construction.
 */
export const HALF_ROW: Fixed = fx.div(fx.fromInt(19), fx.fromInt(68));

/**
 * The vertical world extent of ONE ROW STEP, in column units: the measured 38 px row step over the
 * 68 px column step (source basis "projection" — 19/34 exactly). The render's
 * `CALIBRATED_HALF_H / (2·CALIBRATED_HALF_W)` is the same ratio in pixels; keep the two in step.
 */
export const ROW_STEP: Fixed = fx.div(fx.fromInt(19), fx.fromInt(34));

/**
 * The world LENGTH of a row-crossing lattice edge (NE/SE/SW/NW — half a column sideways, one row
 * down/up): √(½² + ROW_STEP²) ≈ 0.7498·ONE, the measured 51 px over the 68 px column step. This is
 * the diagonal edge cost the pathfinder prices and the leg length the mover paces — one truncated
 * isqrt below the true value, exactly like the old SQRT2 (a heuristic built on it stays admissible).
 */
export const DIAGONAL_STEP: Fixed = fx.isqrt(
  fx.add(fx.mul(HALF_COLUMN, HALF_COLUMN), fx.mul(ROW_STEP, ROW_STEP)),
);

/** Fixed-point 2 — the stagger's row period (kept local; only the wave math needs it). */
const TWO: Fixed = fx.fromInt(2);

/**
 * The stagger's sideways shift (in column units) at a — possibly fractional — row: 0 on even rows,
 * {@link HALF_COLUMN} on odd rows, linear between (the same triangle wave the render's `tileToScreen`
 * interpolates, so a walking entity's sim world-position and its drawn position agree). Robust to
 * negative rows. Pure fixed-point.
 */
export function staggerShift(row: Fixed): Fixed {
  const m = fx.mod(fx.add(fx.mod(row, TWO), TWO), TWO); // row's place in the 2-row cycle, in [0, 2)
  const wave = fx.sub(ONE, fx.abs(fx.sub(ONE, m))); // 0 at even rows, ONE at odd, linear between
  return fx.div(wave, TWO);
}

/**
 * A position's world X in column units: its column plus the stagger shift of its (fractional) row —
 * the sim twin of the render's `tileToScreen` x term. Pure fixed-point.
 */
export function worldX(x: Fixed, y: Fixed): Fixed {
  return fx.add(x, staggerShift(y));
}

/**
 * The world-metric straight-line distance between two grid positions (fractional allowed), in column
 * units: Euclidean over (Δ worldX, Δ row · ROW_STEP). Exact for any segment that stays within one
 * stagger half-period (every lattice-edge leg does — the stagger is linear between integer rows); a
 * longer re-path leg crossing a parity kink under-reads by a few percent for that one leg (the true
 * path bends at the integer row), which only means the mover paces that leg marginally fast — still
 * fully deterministic. Pure fixed-point. SPAN BOUND: the squared deltas overflow the 2^53-exact range
 * once a single span exceeds ~1400 columns — fine for its purpose (leg-length pacing, deltas of a few
 * cells) but NOT a map-scale distance query; a nearest-X consumer over whole-map spans needs a
 * rescaled variant, not this one.
 */
export function worldDistance(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): Fixed {
  const dwx = fx.sub(worldX(bx, by), worldX(ax, ay));
  const dwy = fx.mul(fx.sub(by, ay), ROW_STEP);
  return fx.isqrt(fx.add(fx.mul(dwx, dwx), fx.mul(dwy, dwy)));
}
