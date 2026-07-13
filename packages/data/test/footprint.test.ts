import { describe, expect, it } from 'vitest';
import { fullStateBlockAreaCells } from '../src/index.js';

/**
 * Locks the collision-footprint reading of a `[GfxLandscape]` block-area table: only the FULL
 * (largest) state's cells count, each `[state, x, y, run]` row expands `run` cells along +x, overlaps
 * are emitted once, and malformed rows contribute nothing. This is the one shared reading of the
 * state axis (sim resource footprints + app map-collision both use it), so its behavior is pinned here.
 */
describe('fullStateBlockAreaCells', () => {
  it('returns nothing for undefined or empty input', () => {
    expect(fullStateBlockAreaCells(undefined)).toEqual([]);
    expect(fullStateBlockAreaCells([])).toEqual([]);
  });

  it('keeps only the largest (full-grown) state and drops smaller states', () => {
    // state 0 is the sapling, state 1 the grown object — collision is conservatively at the grown size.
    const cells = fullStateBlockAreaCells([
      [0, 0, 0, 2],
      [1, 5, 5, 1],
    ]);
    expect(cells).toEqual([{ dx: 5, dy: 5 }]);
  });

  it('expands a run into consecutive cells along +x', () => {
    expect(fullStateBlockAreaCells([[0, 0, 0, 3]])).toEqual([
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 2, dy: 0 },
    ]);
  });

  it('emits overlapping cells only once', () => {
    // Two full-state rows whose runs overlap at (1,0) — the shared cell appears once.
    expect(
      fullStateBlockAreaCells([
        [0, 0, 0, 2],
        [0, 1, 0, 2],
      ]),
    ).toEqual([
      { dx: 0, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 2, dy: 0 },
    ]);
  });

  it('ignores a full-state row with a non-positive run', () => {
    expect(
      fullStateBlockAreaCells([
        [0, 0, 0, 1],
        [0, 5, 5, 0],
      ]),
    ).toEqual([{ dx: 0, dy: 0 }]);
  });
});
