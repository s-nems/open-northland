import { describe, expect, it } from 'vitest';
import { plotOutlines } from '../src/gpu/overlays/construction-plot.js';

/**
 * plotOutlines — the construction-plot union outline in the rotated `(u,v)` frame (`u = col+row`,
 * `v = col−row`), where each cell diamond is the axis-aligned 2×2 square centred on its `(u,v)`.
 * The load-bearing data decision behind the rounded plot wash: shared edges cancel, overlapping
 * diamonds union into one loop, and collinear runs merge so the rounding only sees real corners.
 */

/** Order-independent loop signature: the vertex set as sorted "u,v" keys. */
function vertexSet(loop: readonly { u: number; v: number }[]): string[] {
  return loop.map((p) => `${p.u},${p.v}`).sort();
}

describe('plotOutlines', () => {
  it('a single cell outlines as its diamond — one 4-corner square in (u,v)', () => {
    const loops = plotOutlines([{ cells: [{ col: 5, row: 5 }] }]);
    expect(loops).toHaveLength(1);
    // Cell (5,5) → (u,v)=(10,0); its diamond is the square [9,11]×[−1,1].
    expect(vertexSet(loops[0] ?? [])).toEqual(['11,-1', '11,1', '9,-1', '9,1'].sort());
  });

  it('two overlapping neighbour cells union into ONE loop with no interior edges', () => {
    // Cells (5,5) and (6,5) — horizontal node neighbours whose diamonds overlap by half.
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
    // Every node in cols 4..6 × rows 4..6 — a dense 3×3 block whose union is one big region.
    const cells = [];
    for (let col = 4; col <= 6; col++) for (let row = 4; row <= 6; row++) cells.push({ col, row });
    const loops = plotOutlines([{ cells }]);
    expect(loops).toHaveLength(1);
    const loop = loops[0] ?? [];
    // Boundary only: every vertex lies on the outline (no vertex strictly inside the region), and
    // consecutive collinear vertices were merged (each vertex is a genuine turn).
    for (let i = 0; i < loop.length; i++) {
      const prev = loop[(i + loop.length - 1) % loop.length];
      const here = loop[i];
      const next = loop[(i + 1) % loop.length];
      if (prev === undefined || here === undefined || next === undefined) continue;
      const straightU = prev.u === here.u && here.u === next.u;
      const straightV = prev.v === here.v && here.v === next.v;
      expect(straightU || straightV).toBe(false); // a kept vertex is a corner, never mid-run
    }
  });
});
