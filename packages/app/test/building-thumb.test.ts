import { describe, expect, it } from 'vitest';
import { TALL_THUMB_RATIO, thumbFit } from '../src/hud/dom/building-thumb.js';

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

  it('shows the upper part of a tall body instead of shrinking it to a sliver', () => {
    const tower = thumbFit({ width: 100, height: 100 * TALL_THUMB_RATIO + 1 }, BOX);
    expect(tower.sw).toBe(100);
    expect(tower.sh).toBe(100);
    expect(tower.sy).toBeGreaterThan(0);
    expect(tower.sy + tower.sh).toBeLessThan(136);
    expect([tower.dx, tower.dy, tower.dw, tower.dh]).toEqual([0, 0, BOX, BOX]);
    // At the ratio itself the body still fits whole.
    const atRatio = thumbFit({ width: 100, height: 100 * TALL_THUMB_RATIO }, BOX);
    expect(atRatio.sh).toBe(100 * TALL_THUMB_RATIO);
  });
});
