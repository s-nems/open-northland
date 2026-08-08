/**
 * The terrain mesh's node geometry. Mesh vertices are the cell-centre nodes of the half-cell lattice the
 * sim's nav grid addresses, and each map cell contributes two triangles spanning between neighbouring
 * cell centres:
 *
 *   A = △ [its own node (apex), the SE-below cell's node, the SW-below cell's node]
 *   B = ▽ [its own node (left), the E cell's node, the SE-below cell's node]
 *
 * so every triangle edge connects two cell centres and the ground lanes' per-triangle pattern picks
 * (`empa`/`empb` → A/B) blend across cells rather than seaming on lattice edges.
 */

/** The sim lattice's integer coordinates (`nav/halfcell.ts`). */
export type NodeXY = readonly [number, number];

/**
 * Cell `(col, row)`'s centre node on the staggered raster's lattice. Must stay the same formula as the
 * sim's `nav/halfcell.ts` `cellAnchorNode`, or mesh vertices drift off nav anchors.
 */
export function cellNode(col: number, row: number): NodeXY {
  return [2 * col + (row & 1), 2 * row];
}

/** The vertex order `coordsA`'s (TL, BR, BL) UV points map onto. */
export function triangleANodes(col: number, row: number): readonly [NodeXY, NodeXY, NodeXY] {
  const [hx, hy] = cellNode(col, row);
  return [
    [hx, hy],
    [hx + 1, hy + 2],
    [hx - 1, hy + 2],
  ];
}

/** The vertex order `coordsB`'s (TL, TR, BR) UV points map onto. */
export function triangleBNodes(col: number, row: number): readonly [NodeXY, NodeXY, NodeXY] {
  const [hx, hy] = cellNode(col, row);
  return [
    [hx, hy],
    [hx + 2, hy],
    [hx + 1, hy + 2],
  ];
}

/**
 * The cell whose centre a triangle-vertex node is: the inverse of {@link cellNode}. Every node the two
 * triangle builders emit sits on a cell centre, so the division is exact. A border cell's triangles can
 * land outside the grid; callers clamp per their lane's rule.
 */
export function nodeCell(hx: number, hy: number): readonly [number, number] {
  const row = hy / 2;
  return [(hx - (row & 1)) / 2, row];
}

/**
 * A node's elevation lift (world px, ≥ 0, to subtract from the projected `y`), with nodes on or beyond
 * the map-border ring clamped to 0. The per-node clamp approximates the engine's per-emitting-cell
 * border zeroing, equivalent on real data because border-ring elevation is 0 across the decoded corpus.
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
 * A node vertex's brightness-lane texture UV: its own cell centre at the lane texel's centre
 * (`(coord + 0.5) / size`), clamped into the grid, so the per-fragment bilinear blends each triangle's
 * shading between its three cell-centre samples. `paddedWidth` is the lane texture's alignment-padded
 * width; the clamp uses the unpadded grid.
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
