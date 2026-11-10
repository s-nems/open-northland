import { describe, expect, it } from 'vitest';
import { Allowance } from '../src/allowance.js';

const BURST = 5;
const REFILL_MS = 2000;

describe('allowance', () => {
  it('lets a burst through, then one per refill', () => {
    const allowance = new Allowance(BURST, REFILL_MS, 0);
    for (let i = 0; i < BURST; i++) expect(allowance.take(0)).toBe(true);
    expect(allowance.has(REFILL_MS - 1)).toBe(false);
    expect(allowance.take(REFILL_MS - 1)).toBe(false);
    expect(allowance.has(REFILL_MS)).toBe(true);
    expect(allowance.take(REFILL_MS)).toBe(true);
    expect(allowance.take(REFILL_MS)).toBe(false);
    expect(allowance.take(REFILL_MS * (BURST + 10))).toBe(true);
  });
});
