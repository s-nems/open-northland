import { describe, expect, it } from 'vitest';
import {
  buildTerrainGraph,
  DIAGONAL_STEP,
  fx,
  HALF_COLUMN,
  HALF_ROW,
  nodeLatticeDistance,
} from '../../../src/index.js';
import { testContent } from '../../fixtures/content.js';
import { rawGrid } from './support.js';

describe('nodeLatticeDistance', () => {
  it('prices a sideways-dominant offset with all rows crossed diagonally plus half-column steps', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(8, 8));
    // (0,0)->(5,3): ax=5, ay=3 → ⌊3/2⌋=1 diagonal + 4 half-columns + the odd leftover half-row.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(5, 3))).toBe(
      fx.add(fx.add(DIAGONAL_STEP, fx.mul(fx.fromInt(4), HALF_COLUMN)), HALF_ROW),
    );
    // Pure E: (0,0)->(4,0) = four half-columns = two full columns.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(4, 0))).toBe(fx.fromInt(2));
    // The diagonal edge itself: (0,0)->(1,2).
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(1, 2))).toBe(DIAGONAL_STEP);
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(0, 0))).toBe(fx.fromInt(0));
  });

  it('prices a vertical-dominant offset with straight half-row steps, diagonals only for the offset', () => {
    const g = buildTerrainGraph(testContent(), rawGrid(8, 8));
    // Straight down the screen, (2,0)->(2,4): four half-row steps, no weave premium.
    expect(nodeLatticeDistance(g, g.nodeAt(2, 0), g.nodeAt(2, 4))).toBe(fx.mul(fx.fromInt(4), HALF_ROW));
    // (0,0)->(1,4): 2·ax=2 ≤ ay=4 — one diagonal absorbs the column, two half-rows remain.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(1, 4))).toBe(
      fx.add(DIAGONAL_STEP, fx.mul(fx.fromInt(2), HALF_ROW)),
    );
    // (0,0)->(0,3): three straight half-rows.
    expect(nodeLatticeDistance(g, g.nodeAt(0, 0), g.nodeAt(0, 3))).toBe(fx.mul(fx.fromInt(3), HALF_ROW));
  });
});
