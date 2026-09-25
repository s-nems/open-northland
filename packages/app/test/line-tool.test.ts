import { hexDistanceBetween } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  createLineTool,
  type LineNode,
  lineReach,
  screenLine,
  straightLine,
} from '../src/hud/tool-panel/line-tool.js';

const MAX_EDGES = 20;

describe('screen line', () => {
  it.each([
    [0, 0, 8, 0],
    [0, 0, 4, 8],
    [7, 8, 3, 0],
    [3, 3, 10, 9],
  ])('walks adjacent hex nodes from (%i,%i) toward (%i,%i)', (startCol, startRow, endCol, endRow) => {
    const nodes = screenLine({ col: startCol, row: startRow }, { col: endCol, row: endRow }, MAX_EDGES);
    expect(nodes[0]).toEqual({ col: startCol, row: startRow });
    for (let i = 1; i < nodes.length; i++) {
      const before = nodes[i - 1];
      const after = nodes[i];
      if (before === undefined || after === undefined) throw new Error('line gap');
      expect(hexDistanceBetween(before.col, before.row, after.col, after.row)).toBe(1);
    }
    expect(nodes.at(-1)).toEqual({ col: endCol, row: endRow });
  });

  it('follows a steep drawn line without stepping a column back and forth', () => {
    const cols = screenLine({ col: 46, row: 30 }, { col: 49, row: 16 }, MAX_EDGES).map((n) => n.col);
    for (let i = 1; i < cols.length; i++) expect(cols[i]).toBeGreaterThanOrEqual(cols[i - 1] ?? 0);
    expect(cols.at(-1)).toBe(49);
  });

  it('runs a line pointed along the hex diagonal as the diagonal', () => {
    expect(screenLine({ col: 10, row: 11 }, { col: 13, row: 5 }, MAX_EDGES)).toEqual(
      straightLine({ col: 10, row: 11 }, { col: 13, row: 5 }, MAX_EDGES),
    );
  });

  it('caps a long line at its edge budget and includes both endpoints', () => {
    const nodes = screenLine({ col: 2, row: 4 }, { col: 80, row: 4 }, MAX_EDGES);
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
      accepts: (col, row) => !(col === 12 && row === 10),
    });
    expect(reach.has('11,10')).toBe(true);
    expect(reach.has('12,10')).toBe(false);
    expect(reach.has('13,10')).toBe(false);
    expect(reach.has('8,10')).toBe(true);
    expect(reach.has('15,10')).toBe(false); // past the edge budget
  });

  it('lights nothing when the anchor itself is refused', () => {
    expect(
      lineReach({ tool: 'test', anchor: { col: 1, row: 1 }, maxEdges: 3, accepts: () => false }).size,
    ).toBe(0);
  });
});

describe('straight line', () => {
  it.each([
    [0, 0, 8, 0],
    [0, 0, 4, 8],
    [7, 8, 3, 0],
    [10, 11, 13, 5],
  ])('walks from (%i,%i) toward (%i,%i) in one repeating stride', (startCol, startRow, endCol, endRow) => {
    const nodes = straightLine({ col: startCol, row: startRow }, { col: endCol, row: endRow }, MAX_EDGES);
    expect(nodes[0]).toEqual({ col: startCol, row: startRow });
    const strides = new Set<string>();
    for (let i = 1; i < nodes.length; i++) {
      const before = nodes[i - 1];
      const after = nodes[i];
      if (before === undefined || after === undefined) throw new Error('line gap');
      expect(hexDistanceBetween(before.col, before.row, after.col, after.row)).toBe(1);
      strides.add(`${after.col - before.col},${after.row - before.row},${before.row & 1}`);
    }
    // A row or column repeats one step; a diagonal alternates one step per row parity.
    expect(strides.size).toBeLessThanOrEqual(2);
  });

  it('runs a diagonal cursor along the hex diagonal', () => {
    expect(straightLine({ col: 10, row: 11 }, { col: 13, row: 5 }, MAX_EDGES)).toEqual([
      { col: 10, row: 11 },
      { col: 11, row: 10 },
      { col: 11, row: 9 },
      { col: 12, row: 8 },
      { col: 12, row: 7 },
      { col: 13, row: 6 },
      { col: 13, row: 5 },
    ]);
  });

  it('snaps a cursor between runs to the nearest one', () => {
    expect(straightLine({ col: 10, row: 10 }, { col: 11, row: 4 }, MAX_EDGES).map((n) => n.col)).toEqual(
      new Array(7).fill(10),
    );
    expect(straightLine({ col: 10, row: 10 }, { col: 14, row: 8 }, MAX_EDGES).map((n) => n.row)).toEqual(
      new Array(5).fill(10),
    );
  });
});

describe('line tool', () => {
  function tool(canPlace: (node: LineNode) => boolean = () => true, built?: (node: LineNode) => boolean) {
    const lines: (readonly LineNode[])[] = [];
    const line = createLineTool({
      tool: 'test',
      maxEdges: MAX_EDGES,
      canPlace,
      ...(built !== undefined ? { built } : {}),
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

  it('keeps a line to the nearest straight run only while asked to', () => {
    const { line, lines } = tool();
    line.click({ col: 10, row: 10 });
    const cursor = { col: 14, row: 8 };
    expect(line.preview(cursor).some((node) => node.row !== 10)).toBe(true);
    expect(line.preview(cursor, true).map((node) => node.row)).toEqual(new Array(5).fill(10));

    line.click(cursor, true);
    expect(lines).toEqual([[10, 11, 12, 13, 14].map((col) => ({ col, row: 10 }))]);
  });

  it('shows one marker under the cursor before a line starts', () => {
    const { line } = tool((node) => node.col !== 9);
    expect(line.preview({ col: 3, row: 2 })).toEqual([{ col: 3, row: 2, state: 'open' }]);
    expect(line.preview({ col: 9, row: 2 })).toEqual([{ col: 9, row: 2, state: 'blocked' }]);
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
    expect(line.preview({ col: 9, row: 2 }).map((node) => node.state)).toEqual([
      'open',
      'open',
      'open',
      'blocked',
      'blocked',
      'blocked',
    ]);
    line.click({ col: 9, row: 2 });
    expect(lines[0]?.map((node) => node.col)).toEqual([4, 5, 6]);
  });

  it('starts on, passes through and ends on built nodes, laying only the open ones', () => {
    const built = (node: LineNode) => node.col === 4 || node.col === 6 || node.col === 8;
    const { line, lines } = tool((node) => !built(node), built);
    line.click({ col: 4, row: 2 });
    expect(line.anchor()).toEqual({ col: 4, row: 2 });
    expect(line.preview({ col: 8, row: 2 }).map((node) => node.state)).toEqual([
      'built',
      'open',
      'built',
      'open',
      'built',
    ]);
    line.click({ col: 8, row: 2 });
    expect(lines[0]?.map((node) => node.col)).toEqual([5, 7]);
  });

  it('lays nothing for a line over built nodes only', () => {
    const { line, lines } = tool(
      () => false,
      () => true,
    );
    line.click({ col: 4, row: 2 });
    line.click({ col: 6, row: 2 });
    expect(lines).toEqual([]);
    expect(line.anchor()).toBeNull();
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
