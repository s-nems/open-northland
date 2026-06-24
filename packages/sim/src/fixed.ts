/**
 * Fixed-point math for the simulation, stored as scaled integers in a plain JS `number`.
 *
 * Why fixed-point: IEEE-754 float results can differ across CPUs / engines for transcendental
 * ops; for lockstep multiplayer and reproducible replays we need bit-identical results. All
 * state-affecting math in `sim` uses these. Rendering may use plain floats (it never feeds back).
 *
 * Why a `number` (double), not int32: JS doubles represent integers EXACTLY up to 2^53. The basic
 * ops (+ - * and Math.round/trunc on integer-valued doubles) are IEEE-deterministic across
 * platforms. Storing in a double (instead of `x | 0`) avoids the silent int32 overflow that bit
 * a previous Q16.16-in-int32 design above ~32767 units. NEVER use Math.sqrt/sin/cos/pow here —
 * add integer helpers if you need them (see fx.isqrt).
 *
 * A `Fixed` is an integer-valued double where one whole unit (e.g. one tile) == ONE == 65536.
 * Safe range: keep magnitudes below ~2^25 units, so that mul's intermediate product stays under
 * 2^53 and remains exact. A 300-tile map sits comfortably inside this.
 */
export type Fixed = number;

export const SHIFT = 16;
export const ONE: Fixed = 1 << SHIFT; // 65536
const MAX_SAFE = Number.MAX_SAFE_INTEGER; // 2^53 - 1

const DEV = true; // flip off in a perf build; assertions catch overflow during development.

function assertSafe(n: number, op: string): void {
  if (DEV && !Number.isSafeInteger(n)) {
    throw new Error(`fixed-point overflow in ${op}: ${n} exceeds the safe integer range`);
  }
}

export const fx = {
  fromInt(n: number): Fixed {
    const v = n * ONE;
    assertSafe(v, 'fromInt');
    return v;
  },
  /** Truncate toward zero to an integer. */
  toInt(a: Fixed): number {
    return Math.trunc(a / ONE);
  },
  /** Use only at boundaries (e.g. parsing content). */
  fromFloat(f: number): Fixed {
    return Math.round(f * ONE);
  },
  /** Use only for rendering/inspection. */
  toFloat(a: Fixed): number {
    return a / ONE;
  },
  add(a: Fixed, b: Fixed): Fixed {
    const v = a + b;
    assertSafe(v, 'add');
    return v;
  },
  sub(a: Fixed, b: Fixed): Fixed {
    const v = a - b;
    assertSafe(v, 'sub');
    return v;
  },
  /** Multiply two Fixeds. Intermediate `a*b` must stay < 2^53 (see safe range above). */
  mul(a: Fixed, b: Fixed): Fixed {
    const p = a * b;
    if (DEV && Math.abs(p) > MAX_SAFE) {
      throw new Error(`fixed-point overflow in mul: |${a} * ${b}| exceeds 2^53; reduce magnitudes`);
    }
    // Deterministic rounding toward zero of the scaled product.
    return Math.trunc(p / ONE);
  },
  /** Divide two Fixeds. */
  div(a: Fixed, b: Fixed): Fixed {
    if (b === 0) throw new Error('fixed-point division by zero');
    const v = Math.trunc((a * ONE) / b);
    assertSafe(a * ONE, 'div');
    return v;
  },
  abs(a: Fixed): Fixed {
    return a < 0 ? -a : a;
  },
  /** Deterministic integer square root of a Fixed (Newton on integers); for distances. */
  isqrt(a: Fixed): Fixed {
    if (a <= 0) return 0;
    // sqrt(a/ONE) * ONE  ==  sqrt(a * ONE)
    const scaled = a * ONE;
    assertSafe(scaled, 'isqrt');
    let x = Math.floor(Math.sqrt(scaled)); // float sqrt then integer-correct below
    // Correct any last-bit float error deterministically.
    while ((x + 1) * (x + 1) <= scaled) x++;
    while (x * x > scaled) x--;
    return x;
  },
} as const;
