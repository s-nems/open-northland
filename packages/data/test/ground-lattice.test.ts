import { describe, expect, it } from 'vitest';
import {
  GROUND_LAND,
  GROUND_VOID,
  GROUND_WATER,
  type GroundKind,
  groundLattice,
  HEX_EDGE,
  HEX_EDGE_COUNT,
  hexEdgeNeighbourX,
  hexEdgeNeighbourY,
  oppositeHexEdge,
} from '../src/index.js';

/** Cells enough that the middle of the map clears the frame no edge enters. */
const WIDTH = 10;
const HEIGHT = 8;
const ALL_EDGES = (1 << HEX_EDGE_COUNT) - 1;

function lattice(paint: (a: GroundKind[], b: GroundKind[]) => void = () => {}) {
  const a = new Array<GroundKind>(WIDTH * HEIGHT).fill(GROUND_LAND);
  const b = new Array<GroundKind>(WIDTH * HEIGHT).fill(GROUND_LAND);
  paint(a, b);
  const { kinds, edges } = groundLattice(WIDTH, HEIGHT, a, b);
  const node = (hx: number, hy: number) => hy * WIDTH * 2 + hx;
  return {
    kind: (hx: number, hy: number) => kinds[node(hx, hy)],
    edges: (hx: number, hy: number) => edges[node(hx, hy)],
    opens: (hx: number, hy: number, edge: number) => ((edges[node(hx, hy)] ?? 0) & (1 << edge)) !== 0,
  };
}

const KINDS: readonly GroundKind[] = [GROUND_LAND, GROUND_VOID, GROUND_WATER];

/** A deterministic patchwork of all three kinds, one lane of a map's triangles. */
function mixedKinds(seed: number): GroundKind[] {
  return Array.from(
    { length: WIDTH * HEIGHT },
    (_, i) => KINDS[(i * seed + (i >> 2)) % KINDS.length] ?? GROUND_LAND,
  );
}

/** Cell (3, 2): an even cell row, so its centre node is (6, 4). */
const CELL = 2 * WIDTH + 3;

describe('groundLattice', () => {
  it('opens all six edges of every node inside unbroken land whose neighbours clear the frame', () => {
    // The frame is at most five columns and four rows deep.
    const g = lattice();
    for (let hy = 5; hy <= 2 * HEIGHT - 6; hy++) {
      for (let hx = 6; hx <= 2 * WIDTH - 7; hx++) expect(g.edges(hx, hy), `(${hx},${hy})`).toBe(ALL_EDGES);
    }
  });

  it('opens every edge from both its nodes', () => {
    const { edges } = groundLattice(WIDTH, HEIGHT, mixedKinds(1), mixedKinds(2));
    const nodeW = 2 * WIDTH;
    for (let i = 0; i < edges.length; i++) {
      const hx = i % nodeW;
      const hy = Math.floor(i / nodeW);
      for (let edge = 0; edge < HEX_EDGE_COUNT; edge++) {
        if (((edges[i] ?? 0) & (1 << edge)) === 0) continue;
        const back = edges[hexEdgeNeighbourY(hy, edge) * nodeW + hexEdgeNeighbourX(hx, hy, edge)] ?? 0;
        expect(back & (1 << oppositeHexEdge(edge)), `(${hx},${hy}) edge ${edge}`).not.toBe(0);
      }
    }
  });

  it('closes an edge that runs only through a void triangle, though land wins both its nodes', () => {
    // Triangle A's midpoints (5,5) and (6,5) also touch the meadow beside it, so both walk; the
    // edge between them lies inside the rock alone.
    const g = lattice((a) => {
      a[CELL] = GROUND_VOID;
    });
    expect(g.kind(5, 5)).toBe(GROUND_LAND);
    expect(g.kind(6, 5)).toBe(GROUND_LAND);
    expect(g.opens(5, 5, HEX_EDGE.EAST)).toBe(false);
    expect(g.opens(6, 5, HEX_EDGE.WEST)).toBe(false);
    // The rock's side towards cell (2, 2) is shared with that cell's meadow triangle B.
    expect(g.opens(6, 4, HEX_EDGE.SOUTH_WEST)).toBe(true);
    expect(g.opens(5, 5, HEX_EDGE.NORTH_EAST)).toBe(true);
  });

  it('joins sea to sea and never to the shore', () => {
    const g = lattice((a, b) => {
      a[CELL] = GROUND_WATER;
      b[CELL] = GROUND_WATER;
      a[CELL + 1] = GROUND_WATER;
      b[CELL + 1] = GROUND_WATER;
    });
    // The two cells' shared side: (7,5) is touched by water alone, the corner (8,4) by meadow too.
    expect(g.kind(7, 5)).toBe(GROUND_WATER);
    expect(g.kind(6, 5)).toBe(GROUND_WATER);
    expect(g.kind(8, 4)).toBe(GROUND_LAND);
    expect(g.opens(6, 5, HEX_EDGE.EAST)).toBe(true);
    expect(g.opens(7, 5, HEX_EDGE.NORTH_EAST)).toBe(false);
  });

  it('opens no edge into the map frame, four rows deep and three to five columns wide by row', () => {
    const g = lattice();
    expect(g.edges(6, 3)).toBe(0);
    expect(g.edges(6, 4)).not.toBe(0);
    expect(g.edges(3, 4)).toBe(0); // row 4 % 4 = 0: four columns
    expect(g.edges(4, 4)).not.toBe(0);
    expect(g.edges(2, 5)).toBe(0); // row 5: three columns
    expect(g.edges(3, 5)).not.toBe(0);
    expect(g.edges(4, 6)).toBe(0); // row 6: five columns
    expect(g.edges(5, 6)).not.toBe(0);
    expect(g.edges(2 * WIDTH - 6, 5)).not.toBe(0); // row 5 on the right: five columns
    expect(g.edges(2 * WIDTH - 5, 5)).toBe(0);
  });
});
