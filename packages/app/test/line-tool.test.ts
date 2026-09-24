import { hexDistanceBetween } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { createLineTool, hexLine, type LineNode, lineReach } from '../src/hud/tool-panel/line-tool.js';

const MAX_EDGES = 20;

describe('hex line', () => {
  it.each([
    [0, 0, 8, 0],
    [0, 0, 4, 8],
    [7, 8, 3, 0],
    [3, 3, 10, 9],
  ])('walks adjacent hex nodes from (%i,%i) toward (%i,%i)', (startCol, startRow, endCol, endRow) => {
    const nodes = hexLine({ col: startCol, row: startRow }, { col: endCol, row: endRow }, MAX_EDGES);
    expect(nodes[0]).toEqual({ col: startCol, row: startRow });
    for (let i = 1; i < nodes.length; i++) {
      const before = nodes[i - 1];
      const after = nodes[i];
      if (before === undefined || after === undefined) throw new Error('line gap');
      expect(hexDistanceBetween(before.col, before.row, after.col, after.row)).toBe(1);
    }
  });

  it('caps a long line at its edge budget and includes both endpoints', () => {
    const nodes = hexLine({ col: 2, row: 4 }, { col: 80, row: 4 }, MAX_EDGES);
    expect(nodes).toHaveLength(MAX_EDGES + 1);
    expect(nodes[0]).toEqual({ col: 2, row: 4 });
    expect(nodes.at(-1)).toEqual({ col: 22, row: 4 });
  });
});

describe('line reach', () => {
  it('lights only the ends whose whole line from the anchor is accepted', () => {
    // A blocked node east of the anchor shadows everything behind it on the same row.
    const reach = lineReach({
      tool: 'test',
      anchor: { col: 10, row: 10 },
      maxEdges: 4,
      canPlace: (col, row) => !(col === 12 && row === 10),
    });
    expect(reach.has('11,10')).toBe(true);
    expect(reach.has('12,10')).toBe(false);
    expect(reach.has('13,10')).toBe(false);
    expect(reach.has('8,10')).toBe(true);
    expect(reach.has('15,10')).toBe(false); // past the edge budget
  });

  it('lights nothing when the anchor itself is refused', () => {
    expect(
      lineReach({ tool: 'test', anchor: { col: 1, row: 1 }, maxEdges: 3, canPlace: () => false }).size,
    ).toBe(0);
  });
});

describe('line tool', () => {
  function tool(canPlace: (node: LineNode) => boolean = () => true) {
    const lines: (readonly LineNode[])[] = [];
    const line = createLineTool({
      tool: 'test',
      maxEdges: MAX_EDGES,
      canPlace,
      commit: (nodes) => lines.push(nodes),
    });
    return { line, lines };
  }

  it('starts on the first click and lays the line on the second, then waits for the next start', () => {
    const { line, lines } = tool();
    line.click({ col: 4, row: 2 });
    expect(line.anchor()).toEqual({ col: 4, row: 2 });
    expect(line.active()?.anchor).toEqual({ col: 4, row: 2 });
    expect(line.preview({ col: 7, row: 2 }).map((node) => node.col)).toEqual([4, 5, 6, 7]);

    line.click({ col: 7, row: 2 });
    expect(lines).toEqual([[4, 5, 6, 7].map((col) => ({ col, row: 2 }))]);
    expect(line.anchor()).toBeNull();
    expect(line.active()).toBeNull();
  });

  it('shows one marker under the cursor before a line starts', () => {
    const { line } = tool((node) => node.col !== 9);
    expect(line.preview({ col: 3, row: 2 })).toEqual([{ col: 3, row: 2, valid: true }]);
    expect(line.preview({ col: 9, row: 2 })).toEqual([{ col: 9, row: 2, valid: false }]);
  });

  it('keeps a started line through a click off the map', () => {
    const { line, lines } = tool();
    line.click({ col: 4, row: 2 });
    line.click(null);
    expect(line.anchor()).toEqual({ col: 4, row: 2 });
    expect(lines).toEqual([]);
  });

  it('refuses to start on a rejected node', () => {
    const { line } = tool(() => false);
    line.click({ col: 4, row: 2 });
    expect(line.anchor()).toBeNull();
  });

  it('marks everything from the first rejection on and lays only the accepted prefix', () => {
    const { line, lines } = tool((node) => node.col < 7);
    line.click({ col: 4, row: 2 });
    expect(line.preview({ col: 9, row: 2 }).map((node) => node.valid)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    line.click({ col: 9, row: 2 });
    expect(lines[0]?.map((node) => node.col)).toEqual([4, 5, 6]);
  });

  it('steps back by dropping a started line, and has nothing to drop after', () => {
    const { line, lines } = tool();
    line.click({ col: 4, row: 2 });
    expect(line.stepBack()).toBe(true);
    expect(line.anchor()).toBeNull();
    expect(line.stepBack()).toBe(false);
    expect(lines).toEqual([]);
  });
});
