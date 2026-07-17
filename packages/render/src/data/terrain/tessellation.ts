/**
 * The terrain mesh's node geometry — which lattice nodes each cell's two triangles span, and what a node
 * vertex samples. The twin of the GPU mesh build in `gpu/terrain/terrain-layer.ts`, with no Pixi import, so
 * the vertex math is unit-tested headlessly.
 *
 * Tessellation (source basis: docs/SOURCES.md "terrain tessellation"): mesh vertices are the
 * cell-centre nodes of the half-cell lattice — cell `(col, row)`'s centre is node
 * `(2·col + (row&1), 2·row)`, the lattice the sim's nav grid addresses. Each map cell contributes
 * two triangles spanning between neighbouring cell centres:
 *
 *   A = △ [its own node (apex), the SE-below cell's node, the SW-below cell's node]
 *   B = ▽ [its own node (left), the E cell's node, the SE-below cell's node]
 *
 * so every triangle edge connects two cell centres and the ground lanes' per-triangle pattern picks
 * (`empa`/`empb` → A/B) blend across cells rather than seaming on lattice edges.
 */

/** A half-cell node address `[hx, hy]` — the sim lattice's integer coordinates (`nav/halfcell.ts`). */
export type NodeXY = readonly [number, number];

/**
 * Cell `(col, row)`'s centre node: `(2·col + (row&1), 2·row)` — the staggered raster's lattice
 * address. Must stay the same formula as the sim's `nav/halfcell.ts` `cellAnchorNode`, or mesh
 * vertices drift off nav anchors.
 */
export function cellNode(col: number, row: number): NodeXY {
  return [2 * col + (row & 1), 2 * row];
}

/**
 * Triangle A (△) of cell `(col, row)`: its 3 vertex nodes `[apex, bottom-right, bottom-left]` =
 * [own centre, SE-below cell's centre, SW-below cell's centre] — the vertex order `coordsA`'s
 * (TL, BR, BL) UV points map onto.
 */
export function triangleANodes(col: number, row: number): readonly [NodeXY, NodeXY, NodeXY] {
  const [hx, hy] = cellNode(col, row);
  return [
    [hx, hy],
    [hx + 1, hy + 2],
    [hx - 1, hy + 2],
  ];
}

/**
 * Triangle B (▽) of cell `(col, row)`: its 3 vertex nodes `[left, right, bottom-apex]` =
 * [own centre, E cell's centre, SE-below cell's centre] — the vertex order `coordsB`'s
 * (TL, TR, BR) UV points map onto.
 */
export function triangleBNodes(col: number, row: number): readonly [NodeXY, NodeXY, NodeXY] {
  const [hx, hy] = cellNode(col, row);
  return [
    [hx, hy],
    [hx + 2, hy],
    [hx + 1, hy + 2],
  ];
}

/**
 * The cell whose centre a triangle-vertex node is: the inverse of {@link cellNode}. Every node the
 * two triangle builders emit sits on a cell centre (even `hy`, `hx` sharing the row's parity), so
 * the division is exact. May land outside the grid for a border cell's triangles (e.g. the last
 * row's SE node); callers clamp per their lane's rule.
 */
export function nodeCell(hx: number, hy: number): readonly [number, number] {
  const row = hy / 2;
  return [(hx - (row & 1)) / 2, row];
}

/**
 * A node's elevation lift (world px, ≥ 0, to subtract from the projected `y`): the node's own
 * cell's lift, with nodes on the map-border ring (or beyond it) clamped to 0. The per-node clamp is
 * an approximation of the engine's per-emitting-cell border zeroing, equivalent on the real data
 * because border-ring elevation is 0 across the decoded corpus (docs/SOURCES.md "terrain
 * tessellation"). `liftAt` (`elevation.ts`) is bilinear, but returns exactly the cell's own lift at
 * an integer cell coordinate.
 */
export function nodeLift(
  liftAt: (col: number, row: number) => number,
  hx: number,
  hy: number,
  width: number,
  height: number,
): number {
  const [col, row] = nodeCell(hx, hy);
  if (col <= 0 || row <= 0 || col >= width - 1 || row >= height - 1) return 0;
  return liftAt(col, row);
}

/**
 * A node vertex's brightness-lane texture UV: the node's own cell centre mapped to the lane texel's
 * centre (`(coord + 0.5) / size`), clamped into the grid, so the per-fragment bilinear blends each
 * triangle's shading between its three cell-centre samples — the engine model (one lighting value
 * per node, interpolated across the triangle). `paddedWidth` is the lane texture's alignment-padded
 * width (`gpu/terrain/lane-texture.ts` `padLaneRows`); the clamp uses the unpadded grid.
 */
export function nodeLaneUV(
  hx: number,
  hy: number,
  width: number,
  height: number,
  paddedWidth: number,
): readonly [number, number] {
  const [col, row] = nodeCell(hx, hy);
  const c = col < 0 ? 0 : col >= width ? width - 1 : col;
  const r = row < 0 ? 0 : row >= height ? height - 1 : row;
  return [(c + 0.5) / paddedWidth, (r + 0.5) / height];
}
