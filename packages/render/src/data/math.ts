/**
 * Tiny shared numeric primitives for `render`'s float math (the mirror of `packages/audio`'s
 * `data/math.ts`), kept in one place instead of re-inlined per module. No Pixi, no canvas — pure, so
 * every data and GPU layer can import them without pulling a dependency in. Floats are fine here; the
 * sim owns the fixed-point determinism.
 */

/** Clamp `v` into the inclusive `[lo, hi]` range (callers pass `lo ≤ hi`). */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Clamp `v` into `[0, 1]` — the common case for eased fractions (reveal, motion alpha, arc progress). */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Linear interpolate from `a` to `b` by `t` (`t` unclamped — callers that need a bounded blend clamp it). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
