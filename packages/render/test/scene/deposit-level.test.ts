import { describe, expect, it } from 'vitest';
import { depositVisualLevel } from '../../src/data/scene/index.js';

/** Unit tests for {@link depositVisualLevel} — the shrink-by-level fill bucket a mined node draws by. */

describe('depositVisualLevel — the shrink-by-level fill bucket', () => {
  it('buckets remaining/initial into [1, levels]: full → levels, dregs → 1, exhausted → 0', () => {
    // initial 10 over 5 levels — ~2 units per level (ceil rounds a partial level UP).
    expect(depositVisualLevel(10, 10, 5)).toBe(5); // full
    expect(depositVisualLevel(9, 10, 5)).toBe(5); // still reads full until a whole level is gone
    expect(depositVisualLevel(8, 10, 5)).toBe(4);
    expect(depositVisualLevel(2, 10, 5)).toBe(1);
    expect(depositVisualLevel(1, 10, 5)).toBe(1); // the dregs — one unit still shows a level
    expect(depositVisualLevel(0, 10, 5)).toBe(0); // exhausted (the node is then removed, so 0 never draws)
  });

  it('steps one level per unit when the deposit size equals the level count', () => {
    expect(depositVisualLevel(5, 5, 5)).toBe(5);
    expect(depositVisualLevel(3, 5, 5)).toBe(3);
    expect(depositVisualLevel(1, 5, 5)).toBe(1);
  });

  it('guards a mis-stamped deposit (never divides by zero)', () => {
    expect(depositVisualLevel(4, 0, 5)).toBe(0); // no size
    expect(depositVisualLevel(4, 5, 0)).toBe(0); // no levels
    expect(depositVisualLevel(-1, 5, 5)).toBe(0); // negative remaining
  });
});
