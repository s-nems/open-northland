import { describe, expect, it } from 'vitest';
import { footprintCellDx, footprintCellMaxAbsDx, fullStateBlockAreaCells } from '../src/index.js';

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

/**
 * Locks the original's odd-row parity shift: footprint offsets are authored in the even-row frame,
 * and an odd-row anchor stamping onto an even row (odd dy) lands one node further +x. Verified by
 * byte-identical `lmwb` replay of owned maps (docs/formats/MAPDAT.md).
 */
describe('footprintCellDx', () => {
  it('keeps every offset unchanged from an even anchor row', () => {
    expect(footprintCellDx(4, { dx: -2, dy: -1 })).toBe(-2);
    expect(footprintCellDx(4, { dx: 3, dy: 0 })).toBe(3);
    expect(footprintCellDx(0, { dx: 1, dy: 1 })).toBe(1);
  });

  it('keeps even-dy offsets unchanged from an odd anchor row', () => {
    expect(footprintCellDx(5, { dx: -2, dy: 0 })).toBe(-2);
    expect(footprintCellDx(5, { dx: 1, dy: 2 })).toBe(1);
    expect(footprintCellDx(5, { dx: 1, dy: -2 })).toBe(1);
  });

  it('shifts odd-dy offsets one node +x from an odd anchor row', () => {
    expect(footprintCellDx(5, { dx: -2, dy: 1 })).toBe(-1);
    expect(footprintCellDx(5, { dx: 0, dy: -1 })).toBe(1);
    expect(footprintCellDx(3, { dx: 2, dy: -3 })).toBe(3);
  });
});

describe('footprintCellMaxAbsDx', () => {
  it('is |dx| for even-dy cells (never shifted)', () => {
    expect(footprintCellMaxAbsDx({ dx: -3, dy: 2 })).toBe(3);
    expect(footprintCellMaxAbsDx({ dx: 2, dy: 0 })).toBe(2);
  });

  it('covers the shifted stamp of odd-dy cells', () => {
    expect(footprintCellMaxAbsDx({ dx: 2, dy: 1 })).toBe(3); // odd anchor stamps at +3
    expect(footprintCellMaxAbsDx({ dx: -3, dy: 1 })).toBe(3); // shift moves -3 to -2: |dx| still bounds
    expect(footprintCellMaxAbsDx({ dx: 0, dy: -1 })).toBe(1); // anchor-column cell reaches +1
  });
});
