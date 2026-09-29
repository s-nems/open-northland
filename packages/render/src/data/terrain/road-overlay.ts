import type { NodeXY } from './tessellation.js';
import { cellNode } from './tessellation.js';

/**
 * Where a road paints the ground. Original behavior: every ground triangle splits into four half-size
 * triangles over its three corner nodes and three edge-midpoint nodes, all half-cell lattice nodes. A
 * half triangle whose three nodes all carry a road paints the opaque `overlay road` ground pattern; one
 * with one or two road nodes paints the `overlay road 1` or `2` transition pair whose alpha is opaque at
 * exactly those corners. Each road node carries its own variant, which the original rolls at random when
 * the road is laid; here it is a hash of the node id.
 *
 * The original places an odd-row node half a node right of the even-row frame, so the midpoint of a
 * triangle's slanted edge is the odd-row node at the edge's left end column.
 */

/** The ground pattern a half triangle wholly on the road paints (`GfxPattern` `EditName`). */
export const ROAD_GROUND_PATTERN = 'overlay road';

/** The two road transitions (`GfxPatternTransition` `EditName`), the per-node variant picks one. */
export const ROAD_TRANSITIONS = ['overlay road 1', 'overlay road 2'] as const;

export type RoadVariant = 0 | 1;

/** Which of a transition's six pairs is opaque at exactly the road corners, indexed by the corner mask
 *  (bit `i` = point `i` of the pair's coords is on the road; 0 and 7 never index). Measured from the
 *  `overlay_road_a` alpha of both road transitions: the pair's opaque corners are the mask's bits. */
const PAIR_BY_ROAD_CORNERS: Readonly<Record<'a' | 'b', readonly number[]>> = {
  a: [-1, 5, 3, 1, 4, 0, 2],
  b: [-1, 5, 4, 0, 3, 1, 2],
};

const ALL_CORNERS = 0b111;

/** A point inside a ground triangle as weights of its three corners, in the triangle's node order. */
export type Barycentric = readonly [number, number, number];

/** One half triangle: its nodes and corner weights in its pattern's point order (A: apex, SE, SW;
 *  B: left, E, SE). */
export interface HalfTriangle {
  readonly which: 'a' | 'b';
  readonly nodes: readonly [NodeXY, NodeXY, NodeXY];
  readonly weights: readonly [Barycentric, Barycentric, Barycentric];
}

/** What one half triangle paints: nothing, the whole road ground, or one transition pair. */
export type RoadPaint =
  | { readonly kind: 'none' }
  | { readonly kind: 'ground' }
  | { readonly kind: 'edge'; readonly variant: RoadVariant; readonly pair: number };

// Corner `i` of the ground triangle, and the midpoint of its edge from corner `i` to corner `j`.
const C0: Barycentric = [1, 0, 0];
const C1: Barycentric = [0, 1, 0];
const C2: Barycentric = [0, 0, 1];
const M01: Barycentric = [0.5, 0.5, 0];
const M02: Barycentric = [0.5, 0, 0.5];
const M12: Barycentric = [0, 0.5, 0.5];

/** The half triangles of cell `(col, row)`'s triangle A over apex P, SE corner Q and SW corner R. */
export function halfTrianglesA(col: number, row: number): readonly HalfTriangle[] {
  const [hx, hy] = cellNode(col, row);
  const p: NodeXY = [hx, hy];
  const q: NodeXY = [hx + 1, hy + 2];
  const r: NodeXY = [hx - 1, hy + 2];
  const pq: NodeXY = [hx, hy + 1];
  const pr: NodeXY = [hx - 1, hy + 1];
  const qr: NodeXY = [hx, hy + 2];
  return [
    { which: 'a', nodes: [p, pq, pr], weights: [C0, M01, M02] },
    { which: 'a', nodes: [pr, qr, r], weights: [M02, M12, C2] },
    { which: 'a', nodes: [pq, q, qr], weights: [M01, C1, M12] },
    { which: 'b', nodes: [pr, pq, qr], weights: [M02, M01, M12] },
  ];
}

/** The half triangles of cell `(col, row)`'s triangle B over left corner P, E corner S and SE corner Q. */
export function halfTrianglesB(col: number, row: number): readonly HalfTriangle[] {
  const [hx, hy] = cellNode(col, row);
  const p: NodeXY = [hx, hy];
  const s: NodeXY = [hx + 2, hy];
  const q: NodeXY = [hx + 1, hy + 2];
  const ps: NodeXY = [hx + 1, hy];
  const pq: NodeXY = [hx, hy + 1];
  const sq: NodeXY = [hx + 1, hy + 1];
  return [
    { which: 'b', nodes: [p, ps, pq], weights: [C0, M01, M02] },
    { which: 'b', nodes: [ps, s, sq], weights: [M01, C1, M12] },
    { which: 'b', nodes: [pq, sq, q], weights: [M02, M12, C2] },
    { which: 'a', nodes: [ps, sq, pq], weights: [M01, M12, M02] },
  ];
}

/** The six nodes a ground triangle's half triangles span, so a road node finds the triangles it
 *  paints. */
export function triangleRoadNodes(col: number, row: number, which: 'a' | 'b'): readonly NodeXY[] {
  const [hx, hy] = cellNode(col, row);
  return which === 'a'
    ? [
        [hx, hy],
        [hx + 1, hy + 2],
        [hx - 1, hy + 2],
        [hx, hy + 1],
        [hx - 1, hy + 1],
        [hx, hy + 2],
      ]
    : [
        [hx, hy],
        [hx + 2, hy],
        [hx + 1, hy + 2],
        [hx + 1, hy],
        [hx, hy + 1],
        [hx + 1, hy + 1],
      ];
}

/** The cells whose triangles a node can touch: its own row of cells and the one above, one column
 *  either side. A superset; {@link triangleRoadNodes} decides. */
export function cellsNearNode(hx: number, hy: number): readonly (readonly [number, number])[] {
  const out: (readonly [number, number])[] = [];
  const rowBelow = Math.floor(hy / 2);
  for (let row = rowBelow - 1; row <= rowBelow; row++) {
    const col = Math.floor((hx - (row & 1)) / 2);
    for (let c = col - 1; c <= col + 1; c++) out.push([c, row]);
  }
  return out;
}

// A 32-bit integer mix (the lowbias32 finalizer), so neighbouring ids pick uncorrelated variants.
const MIX_SHIFT_A = 16;
const MIX_MUL_A = 0x7feb352d;
const MIX_SHIFT_B = 15;
const MIX_MUL_B = 0x846ca68b;

/** A road node's variant: fixed per node, uncorrelated between neighbours. */
export function roadVariant(nodeId: number): RoadVariant {
  let h = nodeId >>> 0;
  h ^= h >>> MIX_SHIFT_A;
  h = Math.imul(h, MIX_MUL_A);
  h ^= h >>> MIX_SHIFT_B;
  h = Math.imul(h, MIX_MUL_B);
  h ^= h >>> MIX_SHIFT_A;
  return (h & 1) as RoadVariant;
}

/**
 * What `half` paints. `roadAt` answers the node's id when a road runs over it, else undefined. The
 * variant is the first road corner's in point order, as the original takes it.
 */
export function roadPaintOf(
  half: HalfTriangle,
  roadAt: (hx: number, hy: number) => number | undefined,
): RoadPaint {
  let mask = 0;
  let first: number | undefined;
  for (const [i, [hx, hy]] of half.nodes.entries()) {
    const id = roadAt(hx, hy);
    if (id === undefined) continue;
    mask |= 1 << i;
    first ??= id;
  }
  if (mask === 0 || first === undefined) return { kind: 'none' };
  if (mask === ALL_CORNERS) return { kind: 'ground' };
  return { kind: 'edge', variant: roadVariant(first), pair: PAIR_BY_ROAD_CORNERS[half.which][mask] ?? 0 };
}
