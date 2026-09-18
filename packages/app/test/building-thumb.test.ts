import { describe, expect, it } from 'vitest';
import { thumbFit } from '../src/hud/dom/building-thumb.js';

const BOX = 72;

describe('building thumbnail fit', () => {
  it('contains a wide or squarish body in the box, centred', () => {
    const wide = thumbFit({ width: 300, height: 150 }, BOX);
    expect(wide).toEqual({ sx: 0, sy: 0, sw: 300, sh: 150, dx: 0, dy: 18, dw: 72, dh: 36 });
    const square = thumbFit({ width: 213, height: 198 }, BOX);
    expect(square.dw).toBe(72);
    expect(square.dh).toBeCloseTo(66.9, 1);
    expect(square.dx).toBe(0);
    expect(square.dy).toBeCloseTo(2.54, 1);
  });

  it('shows a tall body whole, standing small in the middle of the box', () => {
    const tower = thumbFit({ width: 100, height: 200 }, BOX);
    expect(tower).toEqual({ sx: 0, sy: 0, sw: 100, sh: 200, dx: 18, dy: 0, dw: 36, dh: 72 });
  });
});
