/**
 * Blood-spurt motion (render-only; world px, render-ticks). A named, eye-calibrated approximation: droplets
 * spray from the wound at chest height and fall to the feet under gravity, then pool and fade. The mark's
 * spawn + decay is {@link import('./marks.js')}'s; this module owns only where a droplet is at an age.
 */

/** A deterministic float in [0, 1) from a mark's seed and a droplet/shaft index — no `Math.random`, so a
 *  `?shot` capture reproduces the exact splatter. */
export function frac(seed: number, i: number): number {
  let x = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000;
}

/** How far up a blood spurt sits from the victim's feet node — the wound height it sprays from and falls back
 *  down to (a viking body is ~32 world px tall; ~40% up puts the wound on the chest). The GPU layer lifts the
 *  blood node here; the droplets then fall exactly this far to pool at the feet. */
export const BLOOD_RISE = 13;
/** Render-ticks a droplet takes to fall from the wound to the feet — the gravity below is tuned to it. */
const BLOOD_FALL_TICKS = 8;
/** Downward acceleration (world px / render-tick²), set so a droplet released at rest falls {@link BLOOD_RISE}
 *  in exactly {@link BLOOD_FALL_TICKS} ticks (`y = ½·g·t²` ⇒ `g = 2·rise / fallTicks²`) — a closed-form landing
 *  time with no per-droplet `sqrt`. */
const BLOOD_GRAVITY = (2 * BLOOD_RISE) / (BLOOD_FALL_TICKS * BLOOD_FALL_TICKS);
/** Initial spread of the droplets around the wound point (world px) — a small fan, not one blob. */
const BLOOD_SPRAY = 3;
/** Max horizontal drift speed as a droplet falls (world px / render-tick) — a slight sideways run. */
const BLOOD_DRIFT = 0.9;
/** Max per-droplet start delay (render-ticks) — staggers the drips so it reads as running, not a single drop. */
const BLOOD_DRIP_STAGGER = 5;
/** Vertical elongation per unit fall-speed, and its cap — a fast drop stretches into a streak. */
const BLOOD_STREAK = 0.35;
const BLOOD_MAX_STREAK = 2.3;
/** A landed droplet's stretch — flattened vertically and spread horizontally into a small pool. */
const BLOOD_POOL_STRETCH_Y = 0.5;
const BLOOD_POOL_STRETCH_X = 1.6;

/** A blood droplet's animated transform at `age` render-ticks after the hit, in the blood node's local
 *  space (origin = the wound, y grows downward to the feet at {@link BLOOD_RISE}). */
interface BloodDroplet {
  readonly x: number;
  readonly y: number;
  /** True once the droplet has reached the ground and become part of the pool. */
  readonly landed: boolean;
  /** Vertical scale: a falling drop is a streak (> 1), a pooled one is flat (< 1). */
  readonly stretchY: number;
  /** Horizontal scale: a pooled drop spreads (> 1), a falling one stays thin (≤ 1). */
  readonly stretchX: number;
}

/**
 * Where droplet `i` of a blood splatter is at `age` render-ticks after the hit: it starts in a small seeded
 * fan around the wound, falls straight down under {@link BLOOD_GRAVITY} with a slight horizontal drift, and
 * settles into a flattened pool at the feet ({@link BLOOD_RISE} below the wound) after a per-droplet delay.
 * Motion is a closed form (no integration state), so it's correct at any render `age`, whole or fractional
 * (the layer feeds it interpolated render time for smooth falling).
 */
export function bloodDroplet(seed: number, i: number, age: number): BloodDroplet {
  // Three consecutive seeded values per droplet (stride 3): initial spread, drift speed, drip delay. The
  // drawing layer draws each droplet's radius from `frac(seed, i + BLOOD_RADIUS_SEED)`, an index range kept
  // disjoint from this `i * 3 + {0,1,2}` band.
  const x0 = (frac(seed, i * 3) - 0.5) * 2 * BLOOD_SPRAY;
  const vx = (frac(seed, i * 3 + 1) - 0.5) * 2 * BLOOD_DRIFT;
  const delay = frac(seed, i * 3 + 2) * BLOOD_DRIP_STAGGER;
  const t = Math.max(0, age - delay);
  const landed = t >= BLOOD_FALL_TICKS;
  const tc = landed ? BLOOD_FALL_TICKS : t; // freeze motion at the landing frame
  const speed = BLOOD_GRAVITY * tc;
  return {
    x: x0 + vx * tc,
    y: 0.5 * BLOOD_GRAVITY * tc * tc,
    landed,
    stretchY: landed ? BLOOD_POOL_STRETCH_Y : Math.min(1 + speed * BLOOD_STREAK, BLOOD_MAX_STREAK),
    stretchX: landed ? BLOOD_POOL_STRETCH_X : 1 / (1 + speed * BLOOD_STREAK * 0.4),
  };
}
