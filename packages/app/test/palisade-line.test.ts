import { hexDistanceBetween } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { PALISADE_LINE_MAX_EDGES, palisadeLine } from '../src/hud/tool-panel/palisade-line.js';

describe('palisade drag line', () => {
  it.each([
    [0, 0, 8, 0],
    [0, 0, 4, 8],
    [7, 8, 3, 0],
    [3, 3, 10, 9],
  ])('walks adjacent hex nodes from (%i,%i) toward (%i,%i)', (startCol, startRow, endCol, endRow) => {
    const nodes = palisadeLine({ col: startCol, row: startRow }, { col: endCol, row: endRow });
    expect(nodes[0]).toEqual({ col: startCol, row: startRow });
    for (let i = 1; i < nodes.length; i++) {
      const before = nodes[i - 1];
      const after = nodes[i];
      expect(before).toBeDefined();
      expect(after).toBeDefined();
      if (before === undefined || after === undefined) continue;
      expect(hexDistanceBetween(before.col, before.row, after.col, after.row)).toBe(1);
    }
  });

  it('caps a long drag at twenty edges and includes both endpoints', () => {
    const nodes = palisadeLine({ col: 2, row: 4 }, { col: 80, row: 4 });
    expect(nodes).toHaveLength(PALISADE_LINE_MAX_EDGES + 1);
    expect(nodes[0]).toEqual({ col: 2, row: 4 });
    expect(nodes.at(-1)).toEqual({ col: 22, row: 4 });
  });
});
