/**
 * Fixed-point math for the simulation: an integer-valued double where one whole unit (one tile) is
 * ONE == 65536. Float results can differ across CPUs and engines, so every state-affecting value in
 * `sim` is fixed point; rendering may use plain floats because it never feeds back.
 *
 * A double rather than an int32, because JS doubles represent integers exactly up to 2^53 and the
 * basic ops (+ - * with Math.round/trunc over integer-valued doubles) are IEEE-deterministic across
 * platforms. Never use Math.sqrt/sin/cos/pow here; add an integer helper instead (see fx.isqrt).
 *
 * Safe range: keep magnitudes below ~2^25 units so `mul`'s intermediate product stays exact under 2^53.
 *
 * `Fixed` is branded, so a raw `number` is not assignable to it and the `fx` helpers are the only mint
 * authority: `fx.fromInt(1)`, not the literal `1`.
 */
import type { Brand } from './brand.js';
export type Fixed = Brand<number, 'Fixed'>;

const SHIFT = 16;
export const ONE: Fixed = (1 << SHIFT) as Fixed; // 65536

/** Fixed-point zero - the additive identity (a from-rest gait, a heading sentinel, the origin). */
export const ZERO: Fixed = 0 as Fixed;

/**
 * The smallest positive Fixed - one scaled-integer ulp (1/65536 of a unit). The floor for per-tick
 * quanta minted by division (`ONE/duration` truncates): a quantum truncated to 0 makes no progress
 * ever, so a consumer that must terminate floors it here instead of stalling.
 */
export const ULP: Fixed = 1 as Fixed;
const MAX_SAFE = Number.MAX_SAFE_INTEGER; // 2^53 - 1
/** The largest `wrap` period, so its mask `period - 1` fits an int32. */
const MAX_WRAP_PERIOD = 2 ** 31;

/** Dev-mode assertions on (overflow checks). Statically eliminated in production builds. */
const DEV: boolean = ((): boolean => {
  const g = globalThis as { process?: { env?: { NODE_ENV?: string } } };
  return g.process?.env?.NODE_ENV !== 'production';
})();

function assertSafe(n: number, op: string): void {
  if (DEV && !Number.isSafeInteger(n)) {
    throw new Error(`fixed-point overflow in ${op}: ${n} exceeds the safe integer range`);
  }
}

/** Guard the intermediate `a*b` product of `mul`/`mulDiv` (already computed as `p`) against
 *  exceeding the exact-integer range; dev-only, statically eliminated in production. */
function assertProductSafe(p: number, a: number, b: number, op: string): void {
  if (DEV && Math.abs(p) > MAX_SAFE) {
    throw new Error(`fixed-point overflow in ${op}: |${a} * ${b}| exceeds 2^53; reduce magnitudes`);
  }
}

export const fx = {
  fromInt(n: number): Fixed {
    const v = n * ONE;
    assertSafe(v, 'fromInt');
    return v as Fixed;
  },
  /** Truncate toward zero to an integer. */
  toInt(a: Fixed): number {
    return Math.trunc(a / ONE);
  },
  /** Use only at boundaries (e.g. parsing content). */
  fromFloat(f: number): Fixed {
    return Math.round(f * ONE) as Fixed;
  },
  /** Use only for rendering/inspection. */
  toFloat(a: Fixed): number {
    return a / ONE;
  },
  add(a: Fixed, b: Fixed): Fixed {
    const v = a + b;
    assertSafe(v, 'add');
    return v as Fixed;
  },
  sub(a: Fixed, b: Fixed): Fixed {
    const v = a - b;
    assertSafe(v, 'sub');
    return v as Fixed;
  },
  /** Multiply two Fixeds. Intermediate `a*b` must stay < 2^53 (see safe range above). */
  mul(a: Fixed, b: Fixed): Fixed {
    const p = a * b;
    assertProductSafe(p, a, b, 'mul');
    // Deterministic rounding toward zero of the scaled product.
    return Math.trunc(p / ONE) as Fixed;
  },
  /** Divide two Fixeds. */
  div(a: Fixed, b: Fixed): Fixed {
    if (b === 0) throw new Error('fixed-point division by zero');
    const v = Math.trunc((a * ONE) / b);
    assertSafe(a * ONE, 'div');
    return v as Fixed;
  },
  /**
   * Divide two Fixeds, rounding the quotient up. For minting per-tick step quanta from a duration:
   * `divCeil(ONE, ticks)` guarantees `ticks` steps cover the whole unit, where plain `div` truncates
   * and leaves an ulp-scale remainder that costs a nearly-stationary extra step. Positive divisor only,
   * and integer-exact through the same float guess plus correction as {@link fx.isqrt}.
   */
  divCeil(a: Fixed, b: Fixed): Fixed {
    if (b <= 0) throw new Error('fixed-point divCeil requires a positive divisor');
    const scaled = a * ONE;
    assertSafe(scaled, 'divCeil');
    let q = Math.trunc(scaled / b); // float guess; corrected to the exact ceiling below
    while (q * b < scaled) q++;
    while ((q - 1) * b >= scaled) q--;
    return q as Fixed;
  },
  /**
   * `a·b/c` with a single truncation toward zero: the scales cancel, so there is no intermediate
   * fixed-point rounding, unlike `mul` then `div`, which truncates twice and can shave several ulps.
   * When `a === c` the result is exactly `b`. Intermediate `a*b` must stay < 2^53, dev-asserted like
   * {@link fx.mul}.
   */
  mulDiv(a: Fixed, b: Fixed, c: Fixed): Fixed {
    if (c === 0) throw new Error('fixed-point division by zero');
    const p = a * b;
    assertProductSafe(p, a, b, 'mulDiv');
    return Math.trunc(p / c) as Fixed;
  },
  /**
   * `a`'s place in a cycle of a power-of-two `period`, floored into `[0, period)` for negative `a` too:
   * the low bits of its two's-complement value, exact for every safe integer since the period divides
   * 2^32. Integer operations only, unlike `%`, whose double path V8 falls to once one input is not a Smi.
   */
  wrap(a: Fixed, period: Fixed): Fixed {
    if (DEV && (period <= 0 || period > MAX_WRAP_PERIOD || (period & (period - 1)) !== 0)) {
      throw new Error(`fixed-point wrap period ${period} is not a power of two up to 2^31`);
    }
    return (a & (period - 1)) as Fixed;
  },
  /** Deterministic integer square root of a Fixed (Newton on integers); for distances. */
  isqrt(a: Fixed): Fixed {
    if (a <= 0) return 0 as Fixed;
    // sqrt(a/ONE) * ONE  ==  sqrt(a * ONE)
    const scaled = a * ONE;
    assertSafe(scaled, 'isqrt');
    let x = Math.floor(Math.sqrt(scaled)); // float sqrt then integer-correct below
    // Correct any last-bit float error deterministically.
    while ((x + 1) * (x + 1) <= scaled) x++;
    while (x * x > scaled) x--;
    return x as Fixed;
  },
} as const;
