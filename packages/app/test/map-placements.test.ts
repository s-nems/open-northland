import { describe, expect, it } from 'vitest';
import { forEachPlacement } from '../src/content/map-placements.js';

/**
 * The shared `[hx, hy, typeIndex]` placement iterator — the one home for the triple stride the object,
 * collision and resource joins read a decoded map's `objects.placements` lane through.
 */
describe('forEachPlacement', () => {
  it('visits each triple in order with its placement ordinal', () => {
    const seen: Array<readonly [number, number, number, number]> = [];
    forEachPlacement([10, 20, 3, 11, 21, 4], (hx, hy, typeIndex, ordinal) => {
      seen.push([hx, hy, typeIndex, ordinal]);
    });
    expect(seen).toEqual([
      [10, 20, 3, 0],
      [11, 21, 4, 1],
    ]);
  });

  it('drops a partial trailing triple instead of yielding an incomplete placement', () => {
    const seen: number[] = [];
    // One full triple plus a two-value tail: the tail is not a placement and must be skipped.
    forEachPlacement([1, 2, 3, 4, 5], (hx) => seen.push(hx));
    expect(seen).toEqual([1]);
  });

  it('does nothing for an empty lane', () => {
    let calls = 0;
    forEachPlacement([], () => {
      calls++;
    });
    expect(calls).toBe(0);
  });
});
