import { describe, expect, it } from 'vitest';
import { plotOutlines } from '../src/gpu/overlays/construction-plot.js';

/**
 * Outlines are built in the rotated `(u,v)` frame (`u = col+row`, `v = col−row`), where each cell diamond
 * is the axis-aligned 2×2 square centred on its `(u,v)`.
 */

/** Order-independent loop signature: the vertex set as sorted "u,v" keys. */
function vertexSet(loop: readonly { u: number; v: number }[]): string[] {
  return loop.map((p) => `${p.u},${p.v}`).sort();
}

/** Twice the shoelace signed area: positive is CCW, negative CW. */
function signedArea2(loop: readonly { u: number; v: number }[]): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i];
    const q = loop[(i + 1) % loop.length];
    if (p === undefined || q === undefined) continue;
    a += p.u * q.v - q.u * p.v;
  }
  return a;
}

describe('plotOutlines', () => {
  it('a single cell outlines as its diamond - one 4-corner square in (u,v)', () => {
    const loops = plotOutlines([{ cells: [{ col: 5, row: 5 }] }]);
    expect(loops).toHaveLength(1);
    // Cell (5,5) → (u,v)=(10,0); its diamond is the square [9,11]×[−1,1].
    expect(vertexSet(loops[0] ?? [])).toEqual(['11,-1', '11,1', '9,-1', '9,1'].sort());
  });

  it('two overlapping neighbour cells union into ONE loop with no interior edges', () => {
    // Cells (5,5) and (6,5) - horizontal node neighbours whose diamonds overlap by half.
    const loops = plotOutlines([
      {
        cells: [
          { col: 5, row: 5 },
          { col: 6, row: 5 },
        ],
      },
    ]);
    expect(loops).toHaveLength(1);
    // The union is the 8-corner staircase of the two 2×2 blocks around (10,0) and (11,1).
    expect(vertexSet(loops[0] ?? [])).toEqual(
      ['9,-1', '11,-1', '11,0', '12,0', '12,2', '10,2', '10,1', '9,1'].sort(),
    );
  });

  it('two separate plots yield two independent loops', () => {
    const loops = plotOutlines([{ cells: [{ col: 2, row: 2 }] }, { cells: [{ col: 20, row: 2 }] }]);
    expect(loops).toHaveLength(2);
    for (const loop of loops) expect(loop).toHaveLength(4);
  });

  it('a filled cell rectangle outlines without interior vertices (collinear runs merged)', () => {
    // A dense 3×3 block of nodes, whose union is one region.
    const cells = [];
    for (let col = 4; col <= 6; col++) for (let row = 4; row <= 6; row++) cells.push({ col, row });
    const loops = plotOutlines([{ cells }]);
    expect(loops).toHaveLength(1);
    const loop = loops[0] ?? [];
    // Every kept vertex is a genuine turn: collinear runs along the boundary are merged away.
    for (let i = 0; i < loop.length; i++) {
      const prev = loop[(i + loop.length - 1) % loop.length];
      const here = loop[i];
      const next = loop[(i + 1) % loop.length];
      if (prev === undefined || here === undefined || next === undefined) continue;
      const straightU = prev.u === here.u && here.u === next.u;
      const straightV = prev.v === here.v && here.v === next.v;
      expect(straightU || straightV).toBe(false);
    }
  });

  it('a corner-pinch (two diamonds touching at one vertex) splits into two separate loops', () => {
    // Blocks [-1,1]² and [1,3]² touch only at (u,v)=(1,1), where the left-turn priority has to keep each
    // region on the left rather than tracing one self-crossing figure-8.
    const loops = plotOutlines([
      {
        cells: [
          { col: 0, row: 0 },
          { col: 2, row: 0 },
        ],
      },
    ]);
    expect(loops).toHaveLength(2);
    expect(vertexSet(loops[0] ?? [])).toEqual(['-1,-1', '-1,1', '1,-1', '1,1'].sort());
    expect(vertexSet(loops[1] ?? [])).toEqual(['1,1', '1,3', '3,1', '3,3'].sort());
  });

  it('a ring footprint yields an outer loop plus an oppositely-wound hole (fill cuts it out)', () => {
    // Eight diamonds tiling a 6×6 (u,v) block around an empty 2×2 centre, with node (2,0) omitted.
    const loops = plotOutlines([
      {
        cells: [
          { col: 3, row: 1 },
          { col: 1, row: 1 },
          { col: 3, row: -1 },
          { col: 1, row: -1 },
          { col: 4, row: 0 },
          { col: 0, row: 0 },
          { col: 2, row: 2 },
          { col: 2, row: -2 },
        ],
      },
    ]);
    expect(loops).toHaveLength(2);
    const outer = loops.find((l) => Math.abs(signedArea2(l)) > 8) ?? [];
    const hole = loops.find((l) => Math.abs(signedArea2(l)) <= 8) ?? [];
    expect(vertexSet(outer)).toEqual(['-1,-1', '-1,5', '5,-1', '5,5'].sort()); // the 6×6 perimeter
    expect(vertexSet(hole)).toEqual(['1,1', '1,3', '3,1', '3,3'].sort()); // the 2×2 centre hole
    // Opposite windings, so a nonzero-winding fill leaves the enclosed hole empty.
    expect(Math.sign(signedArea2(outer))).toBe(-Math.sign(signedArea2(hole)));
  });
});
