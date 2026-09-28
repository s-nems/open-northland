import { hexDistanceBetween } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  createLineTool,
  type LineNode,
  lineReach,
  routedLine,
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

/** Every consecutive pair of `nodes` is one hex step apart. */
function expectConnected(nodes: readonly LineNode[]): void {
  for (let i = 1; i < nodes.length; i++) {
    const before = nodes[i - 1];
    const after = nodes[i];
    if (before === undefined || after === undefined) throw new Error('line gap');
    expect(hexDistanceBetween(before.col, before.row, after.col, after.row)).toBe(1);
  }
}

describe('line reach', () => {
  it('lights the ends a line bends to around a refused node, within the edge budget', () => {
    const reach = lineReach({ col: 10, row: 10 }, 4, (col, row) => !(col === 12 && row === 10));
    expect(reach.get('11,10')).toBe(1);
    expect(reach.has('12,10')).toBe(false);
    // Straight it is three steps; around the refused node, four.
    expect(reach.get('13,10')).toBe(4);
    expect(reach.has('14,10')).toBe(false);
    expect(reach.get('8,10')).toBe(2);
  });

  it('leaves out ground a refused wall closes off', () => {
    // Refused column 12 splits the ground.
    const reach = lineReach({ col: 10, row: 10 }, 6, (col) => col !== 12);
    expect(reach.has('11,10')).toBe(true);
    expect(reach.has('13,10')).toBe(false);
  });

  it('lights nothing when the anchor itself is refused', () => {
    expect(lineReach({ col: 1, row: 1 }, 3, () => false).size).toBe(0);
  });
});

describe('routed line', () => {
  it('takes a shortest line of accepted nodes around an obstacle', () => {
    const blocked = new Set(['12,9', '12,10', '12,11']);
    const anchor = { col: 10, row: 10 };
    const end = { col: 14, row: 10 };
    const reach = lineReach(anchor, MAX_EDGES, (col, row) => !blocked.has(`${col},${row}`));
    const nodes = routedLine(anchor, end, reach);
    if (nodes === null) throw new Error('no route');
    expect(nodes[0]).toEqual(anchor);
    expect(nodes.at(-1)).toEqual(end);
    expectConnected(nodes);
    expect(nodes.some((node) => blocked.has(`${node.col},${node.row}`))).toBe(false);
    expect(nodes).toHaveLength((reach.get('14,10') ?? 0) + 1);
  });

  it('has no line to an end out of reach', () => {
    const reach = lineReach({ col: 0, row: 0 }, 2, () => true);
    expect(routedLine({ col: 0, row: 0 }, { col: 5, row: 0 }, reach)).toBeNull();
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
      answersKey: () => '',
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

  it('chains the next line from where the laid one ends, without laying that node again', () => {
    const { line, lines } = tool((node) => node.col < 7);
    line.click({ col: 4, row: 2 });
    line.click({ col: 9, row: 2 }, { chain: true });
    expect(lines[0]?.map((node) => node.col)).toEqual([4, 5, 6]);
    expect(line.anchor()).toEqual({ col: 6, row: 2 });
    expect(line.preview({ col: 6, row: 4 })[0]).toEqual({ col: 6, row: 2, state: 'built' });

    line.click({ col: 6, row: 4 });
    expect(lines[1]?.some((node) => node.col === 6 && node.row === 2)).toBe(false);
    expect(line.anchor()).toBeNull();
  });

  it('keeps a line to the nearest straight run only while asked to', () => {
    const { line, lines } = tool();
    line.click({ col: 10, row: 10 });
    const cursor = { col: 14, row: 8 };
    expect(line.preview(cursor).some((node) => node.row !== 10)).toBe(true);
    expect(line.preview(cursor, true).map((node) => node.row)).toEqual(new Array(5).fill(10));

    line.click(cursor, { straight: true });
    expect(lines).toEqual([[10, 11, 12, 13, 14].map((col) => ({ col, row: 10 }))]);
  });

  it('bends a started line around a refused node and lays it whole', () => {
    const { line, lines } = tool((node) => !(node.col === 6 && node.row === 2));
    line.click({ col: 4, row: 2 });
    const preview = line.preview({ col: 8, row: 2 });
    expect(preview.every((node) => node.state === 'open')).toBe(true);
    expect(preview.some((node) => node.col === 6 && node.row === 2)).toBe(false);
    expect(preview.at(-1)).toEqual({ col: 8, row: 2, state: 'open' });
    expectConnected(preview);

    line.click({ col: 8, row: 2 });
    expect(lines).toEqual([preview.map(({ col, row }) => ({ col, row }))]);
  });

  it('keeps the straight line with its refused tail when no free line reaches the cursor', () => {
    const { line } = tool((node) => node.col !== 6);
    line.click({ col: 4, row: 2 });
    expect(line.preview({ col: 8, row: 2 }).map((node) => node.state)).toEqual([
      'open',
      'open',
      'blocked',
      'blocked',
      'blocked',
    ]);
  });

  it('keeps a held straight run straight past a refused node', () => {
    const { line } = tool((node) => !(node.col === 6 && node.row === 2));
    line.click({ col: 4, row: 2 });
    expect(line.preview({ col: 8, row: 2 }, true).map((node) => node.state)).toEqual([
      'open',
      'open',
      'blocked',
      'blocked',
      'blocked',
    ]);
  });

  it('walks a started line reach again only when the answers change', () => {
    let answers = 'a';
    let probed = 0;
    let refused = -1;
    const line = createLineTool({
      tool: 'test',
      maxEdges: 3,
      canPlace: (node) => {
        probed++;
        return node.col !== refused;
      },
      answersKey: () => answers,
      commit: () => undefined,
    });
    line.click({ col: 4, row: 2 });
    const active = line.active();
    if (active === null) throw new Error('no line');
    const first = active.reach();
    const walked = probed;
    expect(active.reach()).toBe(first);
    expect(probed).toBe(walked);

    refused = 5;
    answers = 'b';
    expect(active.reach().has(5, 2)).toBe(false);
    expect(first.has(5, 2)).toBe(true);
  });

  it('lights the nodes a line can start on, open or built, until the answers change', () => {
    let answers = 'a';
    const line = createLineTool({
      tool: 'test',
      maxEdges: MAX_EDGES,
      canPlace: (node) => node.col < 5,
      built: (node) => node.col === 9,
      answersKey: () => answers,
      commit: () => undefined,
    });
    const starts = line.starts();
    expect([starts.has(4, 2), starts.has(6, 2), starts.has(9, 2)]).toEqual([true, false, true]);
    expect(line.starts()).toBe(starts);
    answers = 'b';
    expect(line.starts().key).not.toBe(starts.key);
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
