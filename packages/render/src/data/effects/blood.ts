/**
 * Blood-spurt motion in world px over render-ticks: an eye-calibrated approximation of droplets
 * spraying from the wound, falling under gravity and pooling at the feet. A mark's spawn and decay
 * belong to `marks.ts`; this module owns only where a droplet is at an age.
 */

/** A deterministic float in [0, 1) from a seed and an index - no `Math.random`, so a capture repeats. */
export function frac(seed: number, i: number): number {
  let x = (seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 0x100000000;
}

/** Wound height above the victim's feet node in world px: the droplets fall exactly this far to pool.
 *  A viking body is ~32 px tall, so this puts the spurt at chest height. */
export const BLOOD_RISE = 13;
/** Render-ticks a droplet takes to fall from the wound to the feet. */
const BLOOD_FALL_TICKS = 8;
/** Downward acceleration in world px / render-tick², set so a droplet released at rest falls
 *  {@link BLOOD_RISE} in exactly {@link BLOOD_FALL_TICKS} ticks. */
const BLOOD_GRAVITY = (2 * BLOOD_RISE) / (BLOOD_FALL_TICKS * BLOOD_FALL_TICKS);
/** Initial spread of the droplets around the wound point, world px. */
const BLOOD_SPRAY = 3;
/** Max horizontal drift speed as a droplet falls, world px / render-tick. */
const BLOOD_DRIFT = 0.9;
/** Max per-droplet start delay in render-ticks - the drips stagger so the blood reads as running. */
const BLOOD_DRIP_STAGGER = 5;
/** Vertical elongation per unit fall-speed, and its cap - a fast drop stretches into a streak. */
const BLOOD_STREAK = 0.35;
const BLOOD_MAX_STREAK = 2.3;
/** A landed droplet's stretch - flattened vertically and spread horizontally into a small pool. */
const BLOOD_POOL_STRETCH_Y = 0.5;
const BLOOD_POOL_STRETCH_X = 1.6;

/** A droplet's transform in blood-node local space: the origin is the wound, y grows down toward the
 *  feet at {@link BLOOD_RISE}. */
interface BloodDroplet {
  readonly x: number;
  readonly y: number;
  readonly landed: boolean;
  /** Vertical scale: > 1 while falling (a streak), < 1 once pooled. */
  readonly stretchY: number;
  /** Horizontal scale: ≤ 1 while falling, > 1 once pooled. */
  readonly stretchX: number;
}

/**
 * Where droplet `i` of a splatter is at `age` render-ticks after the hit. A closed form with no
 * integration state, so a fractional (interpolated) age is as valid as a whole tick.
 */
export function bloodDroplet(seed: number, i: number, age: number): BloodDroplet {
  // Stride 3 per droplet: spread, drift, delay. The drawing layer's radius seeds use an index band
  // kept disjoint from this one.
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
