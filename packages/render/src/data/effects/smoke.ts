import { clamp01 } from '../math.js';
import { frac } from './blood.js';

/**
 * The pure half of the damage-smoke overlay: how many smoke emitters a damaged building shows and where
 * each puff of a looping plume is at a tick. Smoke is a pure function of the building's CURRENT HP
 * fraction — every {@link DAMAGE_SMOKE_STEP} of the pool lost adds one emitter, and any HP rise (repair,
 * an upgrade refilling the pool) sheds them again with no extra wiring. Procedural grey puffs (a named
 * approximation — the decoded `fx smoke` loop art is the ambient-fx ticket's swap-in); tick-driven, so a
 * `?shot` capture and a paused game reproduce exactly.
 */

/** The HP fraction lost per additional smoke emitter (20% → up to {@link MAX_SMOKE_EMITTERS} plumes). */
export const DAMAGE_SMOKE_STEP = 0.2;

/** The most emitters one building shows — heavy damage reads as a burning roofline, not a screen of fog. */
export const MAX_SMOKE_EMITTERS = 4;

/** Concurrent puffs per emitter (phase-staggered fractions of the loop, so the plume never gaps). */
export const SMOKE_PUFFS_PER_EMITTER = 6;

/** One puff's rise loop, in sim ticks (~2.5 s at 12 Hz). */
export const SMOKE_PUFF_PERIOD_TICKS = 30;

/** World px a puff rises over its loop. */
export const SMOKE_RISE_PX = 34;

/** Peak sideways drift of a puff over its rise, in world px (seeded per puff, either direction). */
const SMOKE_DRIFT_PX = 8;

/** A puff's radius from birth to dissolve, in world px. */
const SMOKE_MIN_R = 3.5;
const SMOKE_MAX_R = 11;

/** Peak opacity of one puff (several overlap, so the plume reads denser than a single circle). */
const SMOKE_PEAK_ALPHA = 0.85;

/** How many smoke emitters a building at `hpFrac` (0..1 of its Health pool remaining) shows: one per
 *  full {@link DAMAGE_SMOKE_STEP} lost, capped at {@link MAX_SMOKE_EMITTERS}. Full health → none. The
 *  epsilon absorbs float error at an exact threshold (1 − 0.8 < 0.2 in doubles). */
export function damageSmokeEmitters(hpFrac: number): number {
  const lost = 1 - clamp01(hpFrac);
  return Math.min(MAX_SMOKE_EMITTERS, Math.floor(lost / DAMAGE_SMOKE_STEP + 1e-9));
}

/** Where emitter `i` of a building sits, as fractions of the sprite's bounds box: `u` across the width
 *  (kept off the edges), `v` down from the top into the roof band. Each emitter owns one horizontal
 *  band of the roof (seeded rotation per building, seeded jitter within the band), so every crossed
 *  damage step smokes from a visibly NEW spot — the plume count reads as a damage gauge. Stable across
 *  frames (no per-frame jitter). */
export function emitterSpot(seed: number, i: number): { u: number; v: number } {
  const band = (i + Math.floor(frac(seed, 97) * MAX_SMOKE_EMITTERS)) % MAX_SMOKE_EMITTERS;
  const withinBand = (band + 0.2 + 0.6 * frac(seed, i * 2)) / MAX_SMOKE_EMITTERS;
  return {
    u: 0.12 + 0.76 * withinBand,
    v: 0.05 + 0.3 * frac(seed, i * 2 + 1),
  };
}

/** One puff's pose this tick, in emitter-local world px. */
export interface SmokePuffPose {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
}

/**
 * Puff `puff` of emitter `emitter` at `tick`: each loops over {@link SMOKE_PUFF_PERIOD_TICKS}, rising
 * {@link SMOKE_RISE_PX} while it swells and thins — born small and faint at the emitter, densest shortly
 * after, dissolved at the top. Puffs stagger the loop by even fractions (plus a seeded phase per
 * emitter), so the plume is continuous. Deterministic in (seed, emitter, puff, tick).
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
    // Quick birth fade-in, then a slow thinning that only dives near the top — the plume stays dense
    // through most of its rise (a legible column), yet still hits 0 at the wrap so re-birth never pops.
    alpha: Math.min(1, t * 4) * (1 - t * t) * SMOKE_PEAK_ALPHA,
  };
}
