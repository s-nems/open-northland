import { describe, expect, it } from 'vitest';
import { type Fixed, fx } from '../../src/core/fixed.js';

/** Past 2^53, where a double stops holding every integer. */
const UNSAFE = 2 ** 53;

describe('the fixed-point overflow asserts', () => {
  // Only the app's production build defines them off; a test run keeps them on.
  it('throw outside a production build', () => {
    expect(() => fx.add(UNSAFE as Fixed, 1 as Fixed)).toThrow(/overflow in add/);
    expect(() => fx.mul(UNSAFE as Fixed, UNSAFE as Fixed)).toThrow(/overflow in mul/);
    expect(() => fx.div(UNSAFE as Fixed, 1 as Fixed)).toThrow(/overflow in div/);
  });
});
