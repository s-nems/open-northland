/** Clamp `v` into the inclusive `[lo, hi]` range (callers pass `lo ≤ hi`). */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp `v` into `[0, 1]`. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Linear interpolate from `a` to `b` by `t`, unclamped - a bounded blend clamps `t` itself. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
