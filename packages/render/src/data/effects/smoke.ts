import { clamp01 } from '../math.js';
import { frac } from './blood.js';

/**
 * The pure half of the damage-smoke overlay: how many smoke emitters a damaged building shows and
 * where each puff of a looping plume is at a tick. The emitter count is a function of current HP
 * alone, so a repair sheds plumes with no extra wiring. Procedural grey puffs are a named
 * approximation of the original's `fx smoke` loop art; they are tick-driven, never wall-clock.
 */

/** The HP fraction lost per additional smoke emitter. */
export const DAMAGE_SMOKE_STEP = 0.2;

/** The most emitters one building shows - heavy damage must read as a roofline, not a screen of fog. */
export const MAX_SMOKE_EMITTERS = 4;

/** Concurrent puffs per emitter, phase-staggered over the loop so the plume never gaps. */
export const SMOKE_PUFFS_PER_EMITTER = 6;

/** One puff's rise loop, in sim ticks (~2.5 s at 12 Hz). */
export const SMOKE_PUFF_PERIOD_TICKS = 30;

/** World px a puff rises over its loop. */
export const SMOKE_RISE_PX = 34;

/** Peak sideways drift of a puff over its rise, in world px. */
const SMOKE_DRIFT_PX = 8;

/** A puff's radius from birth to dissolve, in world px. */
const SMOKE_MIN_R = 3.5;
const SMOKE_MAX_R = 11;

/** Peak opacity of one puff. */
const SMOKE_PEAK_ALPHA = 0.85;

/** How many emitters a building at `hpFrac` (0..1 of its Health pool remaining) shows. The epsilon
 *  absorbs float error at an exact threshold (1 − 0.8 < 0.2 in doubles). */
export function damageSmokeEmitters(hpFrac: number): number {
  const lost = 1 - clamp01(hpFrac);
  return Math.min(MAX_SMOKE_EMITTERS, Math.floor(lost / DAMAGE_SMOKE_STEP + 1e-9));
}

/** The roof wedge emitter spots are pinned to, as bounds-box fractions: at most `halfSpread` from the
 *  center line, starting `topV` below the sprite top, dropping `slope` per unit of center offset, with
 *  up to `jitter` extra seeded depth. An approximation of building silhouettes, which narrow toward
 *  the top, so a spot high in a box corner would smoke from thin air beside the roof. */
export const EMITTER_WEDGE = { halfSpread: 0.32, topV: 0.1, slope: 0.35, jitter: 0.08 } as const;

/** Where emitter `i` of a building sits, as fractions of the sprite's bounds box: `u` across the
 *  width, `v` down from the top, on the centered {@link EMITTER_WEDGE}. Each emitter owns one seeded
 *  horizontal band, so every crossed damage step smokes from a visibly new spot. Stable across
 *  frames. */
export function emitterSpot(seed: number, i: number): { u: number; v: number } {
  const band = (i + Math.floor(frac(seed, 97) * MAX_SMOKE_EMITTERS)) % MAX_SMOKE_EMITTERS;
  // The spot's center offset in [-1, 1] - stratified by band, so spots never clump.
  const c = ((band + 0.2 + 0.6 * frac(seed, i * 2)) / MAX_SMOKE_EMITTERS) * 2 - 1;
  return {
    u: 0.5 + EMITTER_WEDGE.halfSpread * c,
    v: EMITTER_WEDGE.topV + EMITTER_WEDGE.slope * Math.abs(c) + EMITTER_WEDGE.jitter * frac(seed, i * 2 + 1),
  };
}

/** One puff's pose this tick; each producer names the local space its `x`/`y` are in. */
export interface SmokePuffPose {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
}

/**
 * Puff `puff` of emitter `emitter` at `tick`, in emitter-local world px: each loops over
 * {@link SMOKE_PUFF_PERIOD_TICKS} while it rises, swells and thins, staggered by an even fraction of
 * the loop plus a seeded per-emitter phase. Deterministic in (seed, emitter, puff, tick).
 */
export function smokePuff(seed: number, emitter: number, puff: number, tick: number): SmokePuffPose {
  const phase =
    (puff * SMOKE_PUFF_PERIOD_TICKS) / SMOKE_PUFFS_PER_EMITTER +
    frac(seed, emitter * 11 + puff) * SMOKE_PUFF_PERIOD_TICKS;
  const age =
    (((tick + phase) % SMOKE_PUFF_PERIOD_TICKS) + SMOKE_PUFF_PERIOD_TICKS) % SMOKE_PUFF_PERIOD_TICKS;
  const t = age / SMOKE_PUFF_PERIOD_TICKS;
  const drift = (frac(seed, emitter * 13 + puff * 3) - 0.5) * 2 * SMOKE_DRIFT_PX;
  return {
    x: drift * t,
    y: -SMOKE_RISE_PX * t,
    radius: SMOKE_MIN_R + (SMOKE_MAX_R - SMOKE_MIN_R) * t,
    // Thins slowly so the column stays legible, but must reach 0 at the wrap or re-birth pops.
    alpha: Math.min(1, t * 4) * (1 - t * t) * SMOKE_PEAK_ALPHA,
  };
}
