/**
 * The original's ground rule on the `2W x 2H` lattice, from each cell's two triangle kinds alone: a
 * node's kind and the six edges it may be left by. Replayed against the stored `lmtw` lane it is
 * byte-identical on every decodable owned map (docs/formats/MAPDAT.md, "Verified `lmtw` derivation").
 */

/** A triangle's or node's ground, ordered so the larger value wins a node: land over void over water. */
export const GROUND_WATER = 0;
export const GROUND_VOID = 1;
export const GROUND_LAND = 2;
export type GroundKind = typeof GROUND_WATER | typeof GROUND_VOID | typeof GROUND_LAND;

/** The original's edge directions, its walk directions' first six; bit `d` of a node's edge mask is
 *  the edge in direction `d`. Rows alternate parity: odd rows sit half a node to +x. */
export const HEX_EDGE = {
  EAST: 0,
  SOUTH_EAST: 1,
  SOUTH_WEST: 2,
  WEST: 3,
  NORTH_WEST: 4,
  NORTH_EAST: 5,
} as const;
/** The number of {@link HEX_EDGE} directions; the first half point down the lattice or east. */
export const HEX_EDGE_COUNT = 6;
const FORWARD_EDGES = HEX_EDGE_COUNT / 2;

/** One lattice edge inside a triangle: its first node relative to the cell's centre node, and the
 *  forward {@link HEX_EDGE} to the second. The centre node always sits on an even row. */
type TriangleEdge = readonly [dx: number, dy: number, edge: number];

/** The six nodes each triangle touches, relative to its cell's centre node: three corners and three
 *  edge midpoints (`packages/render/src/data/terrain/tessellation.ts` owns the mesh). */
const TRIANGLE_A_NODES: readonly (readonly [number, number])[] = [
  [0, 0],
  [1, 2],
  [-1, 2],
  [0, 1],
  [-1, 1],
  [0, 2],
];
const TRIANGLE_B_NODES: readonly (readonly [number, number])[] = [
  [0, 0],
  [2, 0],
  [1, 2],
  [1, 0],
  [0, 1],
  [1, 1],
];
/** The nine lattice edges joining a triangle's six nodes: its three sides halved and the three inside. */
const TRIANGLE_A_EDGES: readonly TriangleEdge[] = [
  [0, 0, HEX_EDGE.SOUTH_EAST],
  [0, 0, HEX_EDGE.SOUTH_WEST],
  [0, 1, HEX_EDGE.SOUTH_EAST],
  [0, 1, HEX_EDGE.SOUTH_WEST],
  [-1, 1, HEX_EDGE.EAST],
  [-1, 1, HEX_EDGE.SOUTH_EAST],
  [-1, 1, HEX_EDGE.SOUTH_WEST],
  [-1, 2, HEX_EDGE.EAST],
  [0, 2, HEX_EDGE.EAST],
];
const TRIANGLE_B_EDGES: readonly TriangleEdge[] = [
  [0, 0, HEX_EDGE.EAST],
  [1, 0, HEX_EDGE.EAST],
  [0, 0, HEX_EDGE.SOUTH_EAST],
  [0, 1, HEX_EDGE.SOUTH_EAST],
  [1, 0, HEX_EDGE.SOUTH_WEST],
  [1, 0, HEX_EDGE.SOUTH_EAST],
  [2, 0, HEX_EDGE.SOUTH_WEST],
  [1, 1, HEX_EDGE.SOUTH_WEST],
  [0, 1, HEX_EDGE.EAST],
];

/** The map frame no edge enters: node rows from the top and bottom, and node columns from the left
 *  and right indexed by `hy % 4`. Original behavior, replayed from `lmtw`. */
const FRAME_ROWS = 4;
const FRAME_LEFT_COLUMNS = [4, 3, 5, 4] as const;
const FRAME_RIGHT_COLUMNS = [4, 5, 3, 4] as const;
const FRAME_PERIOD = FRAME_LEFT_COLUMNS.length;

/** A kind no triangle gave: an edge outside every triangle, which never opens. */
const NO_KIND = -1;

export interface GroundLattice {
  /** Each node's {@link GroundKind}, row-major over `2W x 2H`; a node no triangle touches is void. */
  readonly kinds: Uint8Array;
  /** Each node's open {@link HEX_EDGE} bits, row-major over `2W x 2H`: the original's `lmtw` lane. */
  readonly edges: Uint8Array;
}

/** The node one forward {@link HEX_EDGE} from `(hx, hy)`. */
function forwardNeighbourX(hx: number, hy: number, edge: number): number {
  const odd = (hy & 1) !== 0;
  if (edge === HEX_EDGE.EAST) return hx + 1;
  if (edge === HEX_EDGE.SOUTH_EAST) return odd ? hx + 1 : hx;
  return odd ? hx : hx - 1;
}

function inFrame(hx: number, hy: number, nodeW: number, nodeH: number): boolean {
  if (hy < FRAME_ROWS || hy >= nodeH - FRAME_ROWS) return true;
  const phase = hy % FRAME_PERIOD;
  return hx < (FRAME_LEFT_COLUMNS[phase] ?? 0) || hx >= nodeW - (FRAME_RIGHT_COLUMNS[phase] ?? 0);
}

/**
 * The lattice of a `width x height`-cell map whose triangle A and B of cell `i` are `a[i]` and `b[i]`.
 * A node takes the best kind among the triangles touching it. An edge opens when both its nodes and
 * the best triangle it lies in share one kind other than void, and neither node is in the map frame.
 */
export function groundLattice(
  width: number,
  height: number,
  a: ArrayLike<GroundKind>,
  b: ArrayLike<GroundKind>,
): GroundLattice {
  const nodeW = width * 2;
  const nodeH = height * 2;
  const nodeKinds = new Int8Array(nodeW * nodeH).fill(NO_KIND);
  const edgeKinds = new Int8Array(nodeW * nodeH * FORWARD_EDGES).fill(NO_KIND);
  const paint = (
    hx: number,
    hy: number,
    kind: GroundKind,
    nodes: readonly (readonly [number, number])[],
    edges: readonly TriangleEdge[],
  ): void => {
    for (const [dx, dy] of nodes) {
      const x = hx + dx;
      const y = hy + dy;
      if (x < 0 || y < 0 || x >= nodeW || y >= nodeH) continue;
      const i = y * nodeW + x;
      if (kind > (nodeKinds[i] ?? NO_KIND)) nodeKinds[i] = kind;
    }
    for (const [dx, dy, edge] of edges) {
      const x = hx + dx;
      const y = hy + dy;
      if (x < 0 || y < 0 || x >= nodeW || y >= nodeH) continue;
      const e = (y * nodeW + x) * FORWARD_EDGES + edge;
      if (kind > (edgeKinds[e] ?? NO_KIND)) edgeKinds[e] = kind;
    }
  };
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const cell = row * width + col;
      const hx = 2 * col + (row & 1);
      const hy = 2 * row;
      paint(hx, hy, a[cell] ?? GROUND_VOID, TRIANGLE_A_NODES, TRIANGLE_A_EDGES);
      paint(hx, hy, b[cell] ?? GROUND_VOID, TRIANGLE_B_NODES, TRIANGLE_B_EDGES);
    }
  }
  const kinds = Uint8Array.from(nodeKinds, (k) => (k === NO_KIND ? GROUND_VOID : k));
  const edges = new Uint8Array(nodeW * nodeH);
  for (let hy = 0; hy < nodeH; hy++) {
    for (let hx = 0; hx < nodeW; hx++) {
      const i = hy * nodeW + hx;
      const kind = kinds[i];
      if (kind === GROUND_VOID || inFrame(hx, hy, nodeW, nodeH)) continue;
      for (let edge = 0; edge < FORWARD_EDGES; edge++) {
        const x = forwardNeighbourX(hx, hy, edge);
        const y = edge === HEX_EDGE.EAST ? hy : hy + 1;
        if (x < 0 || x >= nodeW || y >= nodeH || inFrame(x, y, nodeW, nodeH)) continue;
        const j = y * nodeW + x;
        if (kinds[j] !== kind || edgeKinds[i * FORWARD_EDGES + edge] !== kind) continue;
        edges[i] = (edges[i] ?? 0) | (1 << edge);
        edges[j] = (edges[j] ?? 0) | (1 << (edge + FORWARD_EDGES));
      }
    }
  }
  return { kinds, edges };
}
