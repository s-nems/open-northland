/** Tiny shared numeric helpers for the audio decision layer. */

/** Clamp `v` into the inclusive `[lo, hi]` range. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation from `a` (t = 0) to `b` (t = 1). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolate positive frequencies on a log scale, so a midpoint sounds like a midpoint. */
export function lerpHz(a: number, b: number, t: number): number {
  return a * (b / a) ** t;
}
