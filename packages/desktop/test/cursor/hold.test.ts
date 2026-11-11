import { describe, expect, it } from 'vitest';
import { pointHeldIn } from '../../src/cursor/hold.js';

const RECT = { x: 100, y: 50, width: 800, height: 600 };

describe('pointHeldIn', () => {
  it('leaves a point inside alone and pulls one outside to the nearest edge pixel', () => {
    expect(pointHeldIn(RECT, { x: 100, y: 649 })).toBeNull();
    expect(pointHeldIn(RECT, { x: 950, y: 20 })).toEqual({ x: 899, y: 50 });
  });
});
