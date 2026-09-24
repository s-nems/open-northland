import { describe, expect, it } from 'vitest';
import { type Fixed, fx, ONE } from '../../src/core/fixed.js';
import { HALF_COLUMN, staggerShift } from '../../src/nav/world-metric.js';

const TWO = fx.fromInt(2);

/** The triangle wave over JS `%`, which carries the dividend's sign, so a negative row is lifted into
 *  the cycle by a second remainder: the reference the integer form must reproduce exactly. */
function remainderStagger(row: number): number {
  const m = (((row % TWO) + TWO) % TWO) as number;
  const wave = ONE - Math.abs(ONE - m);
  return Math.trunc((wave * ONE) / TWO);
}

describe('the stagger shift', () => {
  it('is zero on even rows and half a column on odd rows', () => {
    for (const row of [-4, -2, 0, 2, 6]) expect(staggerShift(fx.fromInt(row))).toBe(0);
    for (const row of [-3, -1, 1, 5]) expect(staggerShift(fx.fromInt(row))).toBe(HALF_COLUMN);
  });

  it('matches the remainder form on every row, fractional and negative ones included', () => {
    const rows: number[] = [];
    // Every ulp across four whole rows either side of zero, covering both parities and both signs.
    for (let row = -4 * ONE; row <= 4 * ONE; row++) rows.push(row);
    // Map-scale rows and the int32 edges, where a mask that dropped high bits would show.
    for (const row of [2 ** 31 - 1, -(2 ** 31), 2 ** 31 + 3, -(2 ** 31) - 3, 2 ** 40 + 5, -(2 ** 40) - 7]) {
      rows.push(row);
    }
    let mismatches = 0;
    for (const row of rows) {
      if (staggerShift(row as Fixed) !== remainderStagger(row)) mismatches++;
    }
    expect(mismatches).toBe(0);
  });
});

describe('fx.wrap', () => {
  it('floors a negative value into the period', () => {
    expect(fx.wrap(fx.fromInt(-1), TWO)).toBe(ONE);
    expect(fx.wrap(-1 as Fixed, TWO)).toBe(TWO - 1);
    expect(fx.wrap(fx.fromInt(3), TWO)).toBe(ONE);
  });

  it('rejects a period that is not a power of two', () => {
    expect(() => fx.wrap(ONE, fx.fromInt(3))).toThrow(/power of two/);
  });
});
