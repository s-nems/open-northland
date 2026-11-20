import type { WindSway } from '../weather/climate.js';
import { frac } from './random.js';

/** Concurrent puffs per emitter, phase-staggered over the loop so the plume never gaps. */
export const SMOKE_PUFFS_PER_EMITTER = 6;

/** One puff's rise loop, in sim ticks (~2.5 s at 12 Hz). */
export const SMOKE_PUFF_PERIOD_TICKS = 30;

/** World px a puff rises over its loop. */
export const SMOKE_RISE_PX = 34;

/** Peak sideways drift of a puff over its rise, in world px. */
const SMOKE_DRIFT_PX = 8;

/** Weather wind on a plume, all tuned by eye: world px a puff drifts downwind over its rise at full
 *  wind, the share of its rise the wind flattens away, and the power that bends the column (drift grows
 *  faster than height, so the plume leaves the roof upright and bends over). */
const SMOKE_WIND_DRIFT_PX = 46;
const SMOKE_WIND_FLATTEN = 0.4;
const SMOKE_WIND_BEND = 1.6;
/** A full gust stretches the drift by this share. */
const SMOKE_GUST_STRETCH = 0.35;

/** A puff's radius from birth to dissolve, in world px. */
const SMOKE_MIN_R = 3.5;
const SMOKE_MAX_R = 11;

/** Peak opacity of one puff. */
const SMOKE_PEAK_ALPHA = 0.85;

/** One puff's pose this tick; each producer names the local space its `x`/`y` are in. */
export interface SmokePuffPose {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly alpha: number;
  /** How far through its rise loop the puff is, 0 at birth to 1 at dissolve. */
  readonly age: number;
}

/** World px a puff at the end of its rise stands downwind in a steady `wind`, signed like its direction. */
function fullLean(wind: WindSway | undefined): number {
  if (wind === undefined || wind.strength === 0) return 0;
  return wind.direction * wind.strength * (1 + SMOKE_GUST_STRETCH * wind.gust) * SMOKE_WIND_DRIFT_PX;
}

/**
 * What `wind` adds to a puff's calm pose while it ages from `from` to `to` of its loop, in emitter-local
 * world px: the step of the lean and flattening {@link smokePuff} gives a steady wind. A producer that
 * sums these steps per puff keeps each puff where the wind left it, so a plume never swings back when
 * the wind drops or turns.
 */
export function smokeWindBlow(
  wind: WindSway | undefined,
  from: number,
  to: number,
  out = { x: 0, y: 0 },
): { x: number; y: number } {
  out.x = fullLean(wind) * (to ** SMOKE_WIND_BEND - from ** SMOKE_WIND_BEND);
  out.y = SMOKE_RISE_PX * SMOKE_WIND_FLATTEN * (wind?.strength ?? 0) * (to - from);
  return out;
}

/**
 * Puff `puff` of emitter `emitter` at `tick`, in emitter-local world px: each loops over
 * {@link SMOKE_PUFF_PERIOD_TICKS} while it rises, swells and thins, staggered by an even fraction of
 * the loop plus a seeded per-emitter phase. Deterministic in (seed, emitter, puff, tick). Weather `wind`
 * leans the plume downwind and flattens its rise; strength 0 is still air.
 */
export function smokePuff(
  seed: number,
  emitter: number,
  puff: number,
  tick: number,
  wind?: WindSway,
  out = { x: 0, y: 0, radius: 0, alpha: 0, age: 0 },
): SmokePuffPose {
  const phase =
    (puff * SMOKE_PUFF_PERIOD_TICKS) / SMOKE_PUFFS_PER_EMITTER +
    frac(seed, emitter * 11 + puff) * SMOKE_PUFF_PERIOD_TICKS;
  const age =
    (((tick + phase) % SMOKE_PUFF_PERIOD_TICKS) + SMOKE_PUFF_PERIOD_TICKS) % SMOKE_PUFF_PERIOD_TICKS;
  const t = age / SMOKE_PUFF_PERIOD_TICKS;
  const drift = (frac(seed, emitter * 13 + puff * 3) - 0.5) * 2 * SMOKE_DRIFT_PX;
  const strength = wind?.strength ?? 0;
  out.x = drift * t + fullLean(wind) * t ** SMOKE_WIND_BEND;
  out.y = -SMOKE_RISE_PX * t * (1 - SMOKE_WIND_FLATTEN * strength);
  out.age = t;
  out.radius = SMOKE_MIN_R + (SMOKE_MAX_R - SMOKE_MIN_R) * t;
  // Both ends fade to zero, so the loop has no visible birth seam.
  out.alpha = Math.min(1, t * 4) * (1 - t * t) * SMOKE_PEAK_ALPHA;
  return out;
}
