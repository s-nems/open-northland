/**
 * The pure geometry half of textured terrain — the twin of the GPU mesh build in
 * `gpu/terrain/terrain-layer.ts`, with no Pixi import, so the vertex/UV math is unit-tested
 * headlessly.
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
 *
 * UV convention (verified across all 927 pattern records + 38 transition records): `coordsA` lists
 * the tile square's (TL, BR, BL) and maps onto A's [apex, SE, SW]; `coordsB` lists (TL, TR, BR)
 * and maps onto B's [left, E, SE] — both in point order, divided by the page size verbatim.
 */

/** A source sub-rectangle in texture pixels — the pattern's tile region within its `text_NNN` page. */
export interface SrcRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The render-local ground binding for one landscape typeId: which texture page + sub-rect to sample,
 * plus a flat-tint fallback colour (the logic-type `debugColor`) for when the page can't be loaded.
 * The app derives this from a `TerrainPattern` IR row; the renderer stays decoupled from `@open-northland/data`.
 */
export interface CellTexture {
  /** The texture page key (e.g. `text_003`) — the key into the loaded page sources. */
  readonly pageKey: string;
  /** The tile's sub-rect within the page, in texture pixels. */
  readonly rect: SrcRect;
  /** The logic-type `debugColor` as `0xRRGGBB` — the flat-tint fallback when the page is unavailable. */
  readonly fallbackColour?: number;
}

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
 * width (`shading.ts` `padLaneRows`); the clamp uses the unpadded grid.
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

// ─── transition overlays (the map's `emt1..emt4` lanes) ───────────────────────────────────────────

// These two constants duplicate `@open-northland/data`'s `TRANSITION_NONE` / `TRANSITION_PAIRS`
// (which the map schema + pipeline validate with) to keep this module import-decoupled from
// `@open-northland/data`; a change to the encoding must touch both sites.

/** A transition lane's "no overlay here" sentinel (u8 max). */
export const TRANSITION_NONE = 255;

/** The pair variants each `[transition]` record carries (six `GfxCoordsA`/`GfxCoordsB` lines). */
const TRANSITION_PAIRS = 6;

/**
 * Decode one transition-lane value: `v < 255` selects transition `⌊v/6⌋` (an index into the map's
 * `transitions.types` dictionary) and pair variant `v % 6` (an index into the record's six UV
 * pairs); `255` = no overlay on this triangle.
 */
export function transitionRef(v: number): { readonly transition: number; readonly pair: number } | undefined {
  if (v === TRANSITION_NONE) return undefined;
  return { transition: Math.floor(v / TRANSITION_PAIRS), pair: v % TRANSITION_PAIRS };
}

// ─── UV helpers ────────────────────────────────────────────────────────────────────────────────────

/**
 * One pattern triangle's 3 normalised UVs from its 6-int pixel-coord tuple (`coordsA`/`coordsB`),
 * as a flat `[u0,v0, u1,v1, u2,v2]` buffer in the tuple's point order. The original's coords are
 * inclusive pixel corners (`0..63` for a 64px tile) — the sub-texel difference is immaterial at
 * tile scale, so the division is straight.
 */
export function triangleUVs(coords: readonly number[], pageW: number, pageH: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < 3; p++) {
    const x = coords[p * 2] ?? 0;
    const y = coords[p * 2 + 1] ?? 0;
    out.push(x / pageW, y / pageH);
  }
  return out;
}

/**
 * The per-typeId path's UV fold: a page sub-rect's corners onto one cell triangle, following the
 * pattern-record convention — triangle `a` gets the rect's (TL, BR, BL), `b` its (TL, TR, BR) —
 * as a flat normalised buffer in vertex order. This lets the approximated representative-tile path
 * share the 1:1 path's tessellation, differing only in which sub-rect it samples.
 */
export function rectTriangleUVs(rect: SrcRect, triangle: 'a' | 'b', pageW: number, pageH: number): number[] {
  const x0 = rect.x / pageW;
  const y0 = rect.y / pageH;
  const x1 = (rect.x + rect.w) / pageW;
  const y1 = (rect.y + rect.h) / pageH;
  return triangle === 'a' ? [x0, y0, x1, y1, x0, y1] : [x0, y0, x1, y0, x1, y1];
}

/**
 * The source sub-rect (in texture pixels) a `TerrainPattern`'s two UV triangles span: the bounding box
 * of `coordsA ∪ coordsB` (each a `[x0,y0, x1,y1, x2,y2]` triple). For a representative full-tile pattern
 * this is the tile's 64×64 square within its page. Pure, so the app can derive a {@link CellTexture}
 * rect without a Pixi dependency.
 */
export function patternSrcRect(coordsA: readonly number[], coordsB: readonly number[]): SrcRect {
  const xs = [coordsA[0], coordsA[2], coordsA[4], coordsB[0], coordsB[2], coordsB[4]];
  const ys = [coordsA[1], coordsA[3], coordsA[5], coordsB[1], coordsB[3], coordsB[5]];
  const finite = (vs: (number | undefined)[]): number[] => vs.filter((v): v is number => v !== undefined);
  const fxs = finite(xs);
  const fys = finite(ys);
  const minX = Math.min(...fxs);
  const minY = Math.min(...fys);
  return { x: minX, y: minY, w: Math.max(...fxs) - minX, h: Math.max(...fys) - minY };
}
