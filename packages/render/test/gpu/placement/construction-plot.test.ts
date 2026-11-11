import { Graphics, GraphicsContext, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { nodeDiamondPoly, TILE_HALF_H, TILE_HALF_W } from '../../../src/data/projection/index.js';
import { type ElevationField, projectNode } from '../../../src/data/terrain/index.js';
import {
  type ConstructionPlotFrame,
  ConstructionPlotLayer,
  fillPlotOutlines,
  plotIslands,
  plotOutlines,
  projectUV,
} from '../../../src/gpu/placement/construction-plot.js';

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
/** A node diamond's half-extents, as the placement overlay draws them. */
const DIAMOND_HALF_W = TILE_HALF_W;
const DIAMOND_HALF_H = TILE_HALF_H / 2;
const EPSILON = 1e-9;

type Cell = { readonly col: number; readonly row: number };

/** A loop's flat world vertices as sorted "x,y" keys. */
function screenSet(loop: readonly { u: number; v: number }[]): string[] {
  return loop
    .map(({ u, v }) => projectUV(FLAT, u, v))
    .map(({ x, y }) => `${x},${y}`)
    .sort();
}

/** The placement overlay's diamond of a node, as sorted "x,y" keys. */
function diamondSet(cell: Cell): string[] {
  const p = projectNode(FLAT, cell.col, cell.row);
  const poly = nodeDiamondPoly(p.x, p.y, DIAMOND_HALF_W, DIAMOND_HALF_H);
  const keys: string[] = [];
  for (let i = 0; i < poly.length; i += 2) keys.push(`${poly[i]},${poly[i + 1]}`);
  return keys.sort();
}

/** How far `(x,y)` sits inside a node diamond: below 1 inside, 1 on the boundary. */
function diamondNorm(cell: Cell, x: number, y: number): number {
  const p = projectNode(FLAT, cell.col, cell.row);
  return Math.abs(x - p.x) / DIAMOND_HALF_W + Math.abs(y - p.y) / DIAMOND_HALF_H;
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

function nodeBlock(col: number, row: number, w: number, h: number): Cell[] {
  const cells: Cell[] = [];
  for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) cells.push({ col: c, row: r });
  return cells;
}

describe('plotOutlines', () => {
  it.each([
    ['an even', { col: 5, row: 4 }],
    ['an odd', { col: 5, row: 5 }],
  ])('outlines a single node on %s row as its placement diamond', (_, cell) => {
    const loops = plotOutlines([{ cells: [cell] }]);
    expect(loops).toHaveLength(1);
    expect(screenSet(loops[0] ?? [])).toEqual(diamondSet(cell));
  });

  it.each([
    ['even', 4],
    ['odd', 5],
  ])('traces the diamond union of a footprint at an %s-row anchor', (_, anchorRow) => {
    const cells = [...nodeBlock(10, anchorRow, 3, 3), { col: 13, row: anchorRow + 1 }];
    const loops = plotOutlines([{ cells }]);
    expect(loops).toHaveLength(1);
    for (const { u, v } of loops[0] ?? []) {
      const { x, y } = projectUV(FLAT, u, v);
      const norms = cells.map((cell) => diamondNorm(cell, x, y));
      // On some node's diamond edge, inside none: a vertex of the union.
      expect(Math.min(...norms)).toBeCloseTo(1, 9);
      expect(norms.every((n) => n > 1 - EPSILON)).toBe(true);
    }
    // Every node's lowest tip on the footprint's bottom row is an outline vertex.
    const bottom = screenSet(loops[0] ?? []);
    for (let col = 10; col < 13; col++) {
      const p = projectNode(FLAT, col, anchorRow + 2);
      expect(bottom).toContain(`${p.x},${p.y + DIAMOND_HALF_H}`);
    }
  });

  it('two overlapping row neighbours union into ONE loop with no interior edges', () => {
    const left = { col: 5, row: 5 };
    const right = { col: 6, row: 5 };
    const loops = plotOutlines([{ cells: [left, right] }]);
    expect(loops).toHaveLength(1);
    const l = projectNode(FLAT, left.col, left.row);
    const r = projectNode(FLAT, right.col, right.row);
    const midX = (l.x + r.x) / 2;
    const notch = DIAMOND_HALF_H / 2;
    expect(screenSet(loops[0] ?? [])).toEqual(
      [
        `${l.x - DIAMOND_HALF_W},${l.y}`,
        `${l.x},${l.y - DIAMOND_HALF_H}`,
        `${midX},${l.y - notch}`,
        `${r.x},${r.y - DIAMOND_HALF_H}`,
        `${r.x + DIAMOND_HALF_W},${r.y}`,
        `${r.x},${r.y + DIAMOND_HALF_H}`,
        `${midX},${l.y + notch}`,
        `${l.x},${l.y + DIAMOND_HALF_H}`,
      ].sort(),
    );
  });

  it('two separate plots yield two independent loops', () => {
    const loops = plotOutlines([{ cells: [{ col: 2, row: 2 }] }, { cells: [{ col: 20, row: 2 }] }]);
    expect(loops).toHaveLength(2);
    for (const loop of loops) expect(loop).toHaveLength(4);
  });

  it('a filled node block outlines without interior vertices (collinear runs merged)', () => {
    const loops = plotOutlines([{ cells: nodeBlock(4, 4, 3, 3) }]);
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
    // Row neighbours two nodes apart touch only at one tip, where the left-turn priority has to keep each
    // region on the left rather than tracing one self-crossing figure-8.
    const a = { col: 0, row: 0 };
    const b = { col: 2, row: 0 };
    const loops = plotOutlines([{ cells: [a, b] }]);
    expect(loops).toHaveLength(2);
    expect(screenSet(loops[0] ?? [])).toEqual(diamondSet(a));
    expect(screenSet(loops[1] ?? [])).toEqual(diamondSet(b));
  });

  it('a ring footprint yields an outer loop plus an oppositely-wound hole (fill cuts it out)', () => {
    const ring = nodeBlock(0, 0, 6, 6).filter(
      ({ col, row }) => col === 0 || col === 5 || row === 0 || row === 5,
    );
    const loops = plotOutlines([{ cells: ring }]);
    expect(loops).toHaveLength(2);
    const [outer, hole] = [...loops].sort((x, y) => Math.abs(signedArea2(y)) - Math.abs(signedArea2(x)));
    // Opposite windings, so a nonzero-winding fill leaves the enclosed hole empty.
    expect(Math.sign(signedArea2(outer ?? []))).toBe(-Math.sign(signedArea2(hole ?? [])));
    const inner = nodeBlock(1, 1, 4, 4);
    for (const loop of [outer, hole]) {
      for (const { u, v } of loop ?? []) {
        const { x, y } = projectUV(FLAT, u, v);
        const norms = ring.map((cell) => diamondNorm(cell, x, y));
        // On some node's diamond edge, inside none: a vertex of the union.
        expect(Math.min(...norms)).toBeCloseTo(1, 9);
        expect(norms.every((n) => n > 1 - EPSILON)).toBe(true);
        // The hole lies over the missing centre, the outer loop off it.
        const overCentre = inner.some((cell) => diamondNorm(cell, x, y) < 1 - EPSILON);
        expect(overCentre).toBe(loop === hole);
      }
    }
  });
});

describe('construction plot picking', () => {
  it('retains identical fog-filtered shapes and replaces only the site whose visible cells changed', () => {
    const layer = new ConstructionPlotLayer();
    const flat = FLAT;
    const plots = (): ConstructionPlotFrame[] => [
      { ref: 7, foundation: true, cells: [{ col: 4, row: 4 }] },
      { ref: 8, foundation: true, cells: [{ col: 10, row: 4 }] },
    ];
    const outline = vi.spyOn(GraphicsContext.prototype, 'roundShape');
    try {
      layer.set(plots(), flat);
      expect(layer.hit(7, 136, 76)).toBe(true);
      expect(layer.hit(8, 340, 76)).toBe(true);
      const outlines = outline.mock.calls.length;
      for (let generation = 0; generation < 5; generation++) {
        layer.set(plots(), flat);
        expect(layer.hit(7, 136, 76)).toBe(true);
        expect(layer.hit(8, 340, 76)).toBe(true);
      }
      expect(outline).toHaveBeenCalledTimes(outlines);

      layer.set(
        [
          { ref: 7, foundation: true, cells: [{ col: 4, row: 4 }] },
          { ref: 8, foundation: true, cells: [{ col: 12, row: 4 }] },
        ],
        flat,
      );
      expect(layer.hit(7, 136, 76)).toBe(true);
      expect(layer.hit(8, 340, 76)).toBe(false);
      expect(layer.hit(8, 408, 76)).toBe(true);
      // The decal's two outlines and the changed site's pick shape.
      expect(outline).toHaveBeenCalledTimes(outlines + 3);
    } finally {
      outline.mockRestore();
      layer.destroy();
    }
  });

  it('lays the earth as a fill over feather strokes of the same outline, each on a path of its own', () => {
    const layer = new ConstructionPlotLayer(Texture.WHITE);
    layer.set([{ ref: 7, foundation: true, cells: [{ col: 4, row: 4 }] }], FLAT);
    const drawn = layer.container.children[0];
    if (!(drawn instanceof Graphics)) throw new Error('missing plot graphics');
    const actions = drawn.context.instructions.map((entry) => entry.action);
    expect(actions.at(-1)).toBe('fill');
    expect(actions.slice(0, -1).every((action) => action === 'stroke')).toBe(true);
    expect(actions.length).toBeGreaterThan(1);
    // The feather reaches past the body's outline; the click shape does not.
    const body = layer.boundsOf(7, undefined);
    expect(drawn.getLocalBounds().minX).toBeLessThan(body?.minX ?? Number.NaN);
    layer.destroy();
  });

  it('draws no earth for a vehicle yard, which is still picked by its body outline', () => {
    const layer = new ConstructionPlotLayer();
    const cells = [{ col: 4, row: 4 }];
    const drawn = (): number => {
      const earth = layer.container.children[0];
      if (!(earth instanceof Graphics)) throw new Error('missing plot graphics');
      return earth.context.instructions.length;
    };
    layer.set([{ ref: 7, foundation: true, cells }], FLAT);
    expect(drawn()).toBe(1);
    layer.set([{ ref: 7, foundation: false, cells }], FLAT);
    expect(drawn()).toBe(0);
    expect(layer.hit(7, 136, 76)).toBe(true);
    layer.destroy();
  });

  it('updates the drawn and clickable plot when elevation changes under the same cells', () => {
    const layer = new ConstructionPlotLayer();
    const plots: ConstructionPlotFrame[] = [{ ref: 7, foundation: true, cells: [{ col: 4, row: 4 }] }];
    layer.set(plots, { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 });
    expect(layer.hit(7, 136, 76)).toBe(true);
    layer.set(plots, { maxLift: 50, liftAt: () => 50, liftAtNode: () => 50 });
    expect(layer.hit(7, 136, 76)).toBe(false);
    expect(layer.hit(7, 136, 26)).toBe(true);
    expect(layer.container.getLocalBounds().maxY).toBeLessThan(50);
    layer.destroy();
  });

  it('selects the lifted ground outline, never the future roof, and extends the body bounds', () => {
    const layer = new ConstructionPlotLayer();
    const elevation = { maxLift: 20, liftAt: () => 20, liftAtNode: () => 20 };
    layer.set([{ ref: 7, foundation: true, cells: [{ col: 4, row: 4 }] }], elevation);
    expect(layer.hit(7, 136, 56)).toBe(true);
    expect(layer.hit(7, 136, -40)).toBe(false);
    expect(layer.hit(7, 170, 56)).toBe(false); // rounded diamond tip
    expect(layer.hit(8, 136, 56)).toBe(false);
    const body = { minX: 130, minY: -90, maxX: 145, maxY: 60 };
    const bounds = layer.boundsOf(7, body);
    expect(bounds?.minY).toBe(-90);
    expect(bounds?.minX).toBeLessThan(body.minX);
    expect(bounds?.maxY).toBeGreaterThan(body.maxY);
    expect(layer.boundsOf(7, body)).toBe(bounds);
    layer.destroy();
  });

  it('moves click ownership when a site is replaced at the same cells, and drops completed or hidden plots', () => {
    const layer = new ConstructionPlotLayer();
    const flat = FLAT;
    const cells = [{ col: 4, row: 4 }];
    layer.set([{ ref: 7, foundation: true, cells }], flat);
    expect(layer.hit(7, 136, 76)).toBe(true);
    layer.set([{ ref: 8, foundation: true, cells }], flat);
    expect(layer.hit(7, 136, 76)).toBe(false);
    expect(layer.hit(8, 136, 76)).toBe(true);
    layer.set([], flat);
    expect(layer.hit(8, 136, 76)).toBe(false);
    expect(layer.boundsOf(8, undefined)).toBeUndefined();
    layer.destroy();
  });
});

describe('construction plot islands', () => {
  /** A slope, so a loop's projection depends on where it stands. */
  const hilly = {
    maxLift: 30,
    liftAt: (col: number, row: number) => (col * 3 + row * 2) % 30,
    liftAtNode: (hx: number, hy: number) => (hx + hy) % 30,
  };
  const block = (ref: number, col: number, row: number, w: number, h: number): ConstructionPlotFrame => {
    const cells: { col: number; row: number }[] = [];
    for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) cells.push({ col: c, row: r });
    return { ref, foundation: true, cells };
  };
  /** Lone plots, an overlapping pair, a corner pinch, plots in a line and a ring around a hole. */
  const town = (): ConstructionPlotFrame[] => [
    block(1, 0, 0, 3, 2),
    block(2, 2, 1, 3, 2),
    block(3, 20, 0, 2, 2),
    { ref: 4, foundation: true, cells: [{ col: 22, row: 2 }] },
    block(5, 40, 10, 2, 1),
    block(6, 44, 10, 2, 1),
    block(7, 30, 30, 6, 1),
    block(8, 30, 31, 1, 4),
    block(9, 35, 31, 1, 4),
    block(10, 30, 35, 6, 1),
    { ref: 11, foundation: true, cells: [{ col: 60, row: 60 }] },
  ];
  /** The path each fill of `context` paints, as its drawing calls; the fill objects carry ids. */
  const shapesOf = (context: GraphicsContext): unknown[] =>
    context.instructions.map((instruction) =>
      instruction.action === 'fill'
        ? instruction.data.path.instructions.map(({ action, data }) => [action, data])
        : instruction.action,
    );
  const drawnShapes = (layer: ConstructionPlotLayer): unknown[] => {
    const g = layer.container.children[0];
    if (!(g instanceof Graphics)) throw new Error('the plot layer draws one Graphics');
    return shapesOf(g.context);
  };
  const freshShapes = (plots: readonly ConstructionPlotFrame[]): unknown[] => {
    const context = new GraphicsContext();
    fillPlotOutlines(context, plots, hilly);
    return shapesOf(context);
  };

  it('groups only plots whose outlines can meet', () => {
    const islands = plotIslands(town()).map((island) => island.map((plot) => plot.ref));
    expect(islands).toEqual([[1, 2], [3, 4], [5], [6], [7, 8, 9, 10], [11]]);
  });

  it('draws what outlining every plot afresh draws, through placed, finished and moved sites', () => {
    const layer = new ConstructionPlotLayer();
    const steps: ConstructionPlotFrame[][] = [
      town(),
      [...town(), block(12, 50, 50, 2, 2)],
      town().filter((plot) => plot.ref !== 2),
      town().map((plot) =>
        plot.ref === 11 ? { ref: 11, foundation: true, cells: [{ col: 61, row: 60 }] } : plot,
      ),
      [...town(), block(13, 23, 0, 1, 1)],
      town().reverse(),
      [],
      town(),
    ];
    try {
      for (const plots of steps) {
        layer.set(plots, hilly);
        expect(drawnShapes(layer)).toEqual(plots.length === 0 ? [] : freshShapes(plots));
      }
    } finally {
      layer.destroy();
    }
  });

  it('outlines again only the island whose plots changed', () => {
    const layer = new ConstructionPlotLayer();
    const round = vi.spyOn(GraphicsContext.prototype, 'roundShape');
    try {
      layer.set(town(), hilly);
      const first = round.mock.calls.map(([points]) => points);
      layer.set(
        [
          ...town().filter((plot) => plot.ref !== 11),
          { ref: 11, foundation: true, cells: [{ col: 61, row: 60 }] },
        ],
        hilly,
      );
      const second = round.mock.calls.slice(first.length).map(([points]) => points);
      expect(second).toHaveLength(first.length);
      // Every loop but the moved site's is the very array drawn before.
      expect(second.filter((points, i) => points !== first[i])).toHaveLength(1);
    } finally {
      round.mockRestore();
      layer.destroy();
    }
  });
});
