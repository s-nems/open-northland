/**
 * Fixed-point math (Q16.16) for the simulation.
 *
 * Why: IEEE-754 float results can differ across CPUs / JS engines / build flags for some
 * operations. For lockstep multiplayer and reproducible replays/tests we need bit-identical
 * results everywhere, so all state-affecting math in `sim` uses these integer-backed fixns.
 * Rendering may use plain floats (it interpolates and never feeds back into state).
 *
 * A `Fixed` is a 32-bit-ish integer where the low 16 bits are the fraction. Stored as a JS
 * number but always an integer value. One whole unit (e.g. one tile) == 1 << 16 == 65536.
 */
export type Fixed = number;

export const SHIFT = 16;
export const ONE: Fixed = 1 << SHIFT; // 65536

export const fx = {
  /** Convert an integer to Fixed. */
  fromInt(n: number): Fixed {
    return (n << SHIFT) | 0;
  },
  /** Truncate a Fixed to an integer (floor toward zero). */
  toInt(a: Fixed): number {
    return a >> SHIFT;
  },
  /** Convert a float to Fixed (use only at boundaries — e.g. parsing content). */
  fromFloat(f: number): Fixed {
    return Math.round(f * ONE) | 0;
  },
  /** Convert a Fixed back to float (use only for rendering/inspection). */
  toFloat(a: Fixed): number {
    return a / ONE;
  },
  add(a: Fixed, b: Fixed): Fixed {
    return (a + b) | 0;
  },
  sub(a: Fixed, b: Fixed): Fixed {
    return (a - b) | 0;
  },
  /** Multiply two Fixeds. Uses a 64-bit intermediate to avoid overflow. */
  mul(a: Fixed, b: Fixed): Fixed {
    return Number((BigInt(a) * BigInt(b)) >> BigInt(SHIFT)) | 0;
  },
  /** Divide two Fixeds. */
  div(a: Fixed, b: Fixed): Fixed {
    return Number((BigInt(a) << BigInt(SHIFT)) / BigInt(b)) | 0;
  },
  abs(a: Fixed): Fixed {
    return a < 0 ? -a : a;
  },
} as const;
