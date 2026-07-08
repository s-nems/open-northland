import { TILE_HALF_H, TILE_HALF_W } from './iso.js';

/**
 * The PURE geometry half of textured terrain — the self-verifiable twin of the GPU mesh build in
 * `gpu/terrain/terrain-layer.ts` (docs/plans/Phase 2, step 4). It turns the approximated typeId→pattern table
 * (`TerrainPattern` IR) into per-cell diamond vertices + UVs, with **no Pixi import**, so the
 * vertex/UV math is unit-tested headlessly while only the rasterised pixels stay human-gated.
 *
 * The original tiles each isometric cell from a `text_NNN` ground texture via two UV triangles; this
 * slice **approximates** that (a recorded deviation, source basis): every cell of a landscape
 * family draws the SAME representative tile, mapped as one square sub-rect onto the diamond. The exact
 * per-cell pattern algorithm is oracle-blocked (no terrain render in OpenVikings).
 */

/** A source sub-rectangle in texture PIXELS — the pattern's tile region within its `text_NNN` page. */
export interface SrcRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The render-local ground binding for one landscape typeId: which texture page + sub-rect to sample,
 * plus a flat-tint fallback colour (the logic-type `debugColor`) for when the page can't be loaded.
 * The app derives this from a `TerrainPattern` IR row; the renderer stays decoupled from `@vinland/data`.
 */
export interface CellTexture {
  /** The texture page key (e.g. `text_003`) — the key into the loaded page sources. */
  readonly pageKey: string;
  /** The tile's sub-rect within the page, in texture pixels. */
  readonly rect: SrcRect;
  /** The logic-type `debugColor` as `0xRRGGBB` — the flat-tint fallback when the page is unavailable. */
  readonly fallbackColour?: number;
}

/**
 * The two-triangle index list for a 4-corner diamond cell whose corners are `[top, right, bottom, left]`:
 * `(top, right, bottom)` + `(top, bottom, left)`. Shared by every cell (offset by the cell's vertex base
 * when batched into one mesh).
 */
export const DIAMOND_INDICES: readonly number[] = [0, 1, 2, 0, 2, 3];

/** No terrain lift — the shared default so the elevation-free path builds byte-identical vertices. */
const NO_CORNER_LIFTS: readonly number[] = [0, 0, 0, 0];

/**
 * The 4 diamond-corner positions (in projected world space, before the camera transform) for a cell
 * centred at `(sx, sy)`, in `[top, right, bottom, left]` order — the same diamond the flat-tint
 * `tileGraphic` traces (`center ± TILE_HALF`), returned as a flat `[x0,y0, x1,y1, …]` vertex buffer.
 *
 * `lifts` (world px, `[top, right, bottom, left]`, from `elevation.ts` `diamondCornerLifts`) is
 * SUBTRACTED from each corner's `y` to lift the terrain by height — baked ONCE at mesh build. Shared
 * corners get identical lifts (the sampler's watertight canonical coordinate), so the mesh stays
 * crack-free. Absent → flat (default), so a synthetic/elevation-free grid is unchanged.
 */
export function diamondCorners(
  sx: number,
  sy: number,
  lifts: readonly number[] = NO_CORNER_LIFTS,
): readonly number[] {
  return [
    sx,
    sy - TILE_HALF_H - (lifts[0] ?? 0), // top
    sx + TILE_HALF_W,
    sy - (lifts[1] ?? 0), // right
    sx,
    sy + TILE_HALF_H - (lifts[2] ?? 0), // bottom
    sx - TILE_HALF_W,
    sy - (lifts[3] ?? 0), // left
  ];
}

/**
 * Normalised UVs (0..1) mapping a page sub-rect's 4 corners onto the diamond corners
 * `[top, right, bottom, left]` → `[TL, TR, BR, BL]`, returned as a flat `[u0,v0, …]` buffer. The square
 * tile is laid 45° onto the diamond; since the representative ground tiles are near-uniform, the
 * rotation is visually immaterial. `pageW`/`pageH` are the texture page's pixel dimensions.
 */
export function rectUVs(rect: SrcRect, pageW: number, pageH: number): readonly number[] {
  const u0 = rect.x / pageW;
  const v0 = rect.y / pageH;
  const u1 = (rect.x + rect.w) / pageW;
  const v1 = (rect.y + rect.h) / pageH;
  return [u0, v0, u1, v0, u1, v1, u0, v1];
}

/**
 * The source sub-rect (in texture pixels) a `TerrainPattern`'s two UV triangles span: the bounding box
 * of `coordsA ∪ coordsB` (each a `[x0,y0, x1,y1, x2,y2]` triple). For a representative full-tile pattern
 * this is the tile's 64×64 square within its page; mapping that square onto the diamond is the
 * approximation. Pure, so the app can derive a {@link CellTexture} rect without a Pixi dependency.
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

// ─── per-triangle 1:1 ground (the decoded map's `empa`/`empb` pattern choice) ──────────────────────
//
// A `GfxPattern` textures a cell with TWO triangles, and every real pattern lists its UV points in one
// fixed convention (verified across all 927 records): `coordsA` = the tile square's (TL, BR, BL),
// `coordsB` = its (TL, TR, BR) — the square split along its TL→BR diagonal. Under the 45° iso
// projection the square's TL/TR/BR/BL corners land on the diamond's top/right/bottom/left, so:
//
//   triangle A: UV points (TL, BR, BL) → diamond corners (top, bottom, left)   — the LEFT half
//   triangle B: UV points (TL, TR, BR) → diamond corners (top, right, bottom)  — the RIGHT half
//
// Rendering each triangle with its own pattern (the map's baked per-triangle choice) is what makes
// coastlines/transition blocks join up 1:1 like the original.

/** Triangle A's diamond-corner indices (into the `[top, right, bottom, left]` corner order), matching its UV point order. */
export const TRIANGLE_A_CORNERS: readonly number[] = [0, 2, 3];

/** Triangle B's diamond-corner indices (into the `[top, right, bottom, left]` corner order), matching its UV point order. */
export const TRIANGLE_B_CORNERS: readonly number[] = [0, 1, 2];

// ─── the CENTRE-vertex split (per-cell lane detail the corner vertices cannot carry) ───────────────
//
// The two ground triangles share the diamond's top↔bottom diagonal, whose midpoint is the cell
// CENTRE. A corner-only mesh interpolates the per-cell lanes (elevation/brightness) purely from
// corner samples — and every corner is a between-cell blend, so a cell's OWN lane value never
// reaches any pixel: one-cell shading detail flattens toward its neighbours (measured on the bridge
// map: a 55-embr cell among ~127 neighbours rendered ×0.84 instead of the corpus-pinned ×0.43 —
// corner interpolation predicts exactly the flattened value). Splitting each triangle at the centre
// adds ONE vertex per cell carrying the cell's own bilinear samples (at the canonical coordinate
// `(col, row)` the corner samples share — `cell-field.ts`), which restores the measured per-cell
// response while leaving the diamond's OUTER edges untouched, so the mesh stays watertight with its
// neighbours. Used only on the shaded (brightness-lane) path; the unshaded mesh stays byte-identical.

/**
 * Index triples for triangle A split at the centre, into the vertex order
 * `[top, bottom, left, centre]` its split builder pushes: `(top, centre, left)` + `(centre, bottom, left)`.
 */
export const TRIANGLE_A_SPLIT_INDICES: readonly number[] = [0, 3, 2, 3, 1, 2];

/**
 * Index triples for triangle B split at the centre, into the vertex order
 * `[top, right, bottom, centre]` its split builder pushes: `(top, right, centre)` + `(centre, right, bottom)`.
 */
export const TRIANGLE_B_SPLIT_INDICES: readonly number[] = [0, 1, 3, 3, 1, 2];

/**
 * The midpoint of two UV points of a pattern triangle's `[u0,v0, u1,v1, u2,v2]` buffer — the centre
 * vertex's UV. The centre bisects the top↔bottom split edge, and UVs vary linearly over a triangle,
 * so the midpoint UV reproduces the exact same texture mapping across both halves. `ia`/`ib` are the
 * POINT indices (0..2) of the split edge's endpoints in the buffer's point order.
 */
export function uvMidpoint(uvs: readonly number[], ia: number, ib: number): [number, number] {
  return [
    ((uvs[ia * 2] ?? 0) + (uvs[ib * 2] ?? 0)) / 2,
    ((uvs[ia * 2 + 1] ?? 0) + (uvs[ib * 2 + 1] ?? 0)) / 2,
  ];
}

/**
 * The 4-triangle centre-fan index list for a diamond whose vertex buffer is the 4 corners
 * (`[top, right, bottom, left]`, {@link diamondCorners}) followed by the centre vertex (index 4) —
 * the shaded twin of {@link DIAMOND_INDICES} for the per-typeId path.
 */
export const DIAMOND_FAN_INDICES: readonly number[] = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4];

/** The centre of a page sub-rect in normalised UV — the {@link DIAMOND_FAN_INDICES} centre vertex's UV. */
export function rectCenterUV(rect: SrcRect, pageW: number, pageH: number): [number, number] {
  return [(rect.x + rect.w / 2) / pageW, (rect.y + rect.h / 2) / pageH];
}

/**
 * One triangle's 3 vertex positions for a cell centred at `(sx, sy)`: the diamond corners named by
 * `cornerIndices` (one of {@link TRIANGLE_A_CORNERS} / {@link TRIANGLE_B_CORNERS}), as a flat
 * `[x0,y0, x1,y1, x2,y2]` buffer in UV-point order. `lifts` (see {@link diamondCorners}) lifts the
 * shared diamond by terrain height before the triangle's corners are picked, so the two triangles of a
 * cell — and the cells around it — join at identical lifted vertices.
 */
export function triangleCorners(
  sx: number,
  sy: number,
  cornerIndices: readonly number[],
  lifts: readonly number[] = NO_CORNER_LIFTS,
): number[] {
  const diamond = diamondCorners(sx, sy, lifts);
  const out: number[] = [];
  for (const c of cornerIndices) {
    out.push(diamond[c * 2] as number, diamond[c * 2 + 1] as number);
  }
  return out;
}

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
