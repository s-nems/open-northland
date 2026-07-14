/** Tiny shared numeric helpers for the audio decision layer. */

/** Clamp `v` into the inclusive `[lo, hi]` range. */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
