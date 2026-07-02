import { TILE_HALF_H, TILE_HALF_W } from './iso.js';

/**
 * The PURE geometry half of textured terrain — the self-verifiable twin of the GPU mesh build in
 * `pixi-renderer.ts` (docs/ROADMAP.md Phase 2, step 4). It turns the approximated typeId→pattern table
 * (`TerrainPattern` IR) into per-cell diamond vertices + UVs, with **no Pixi import**, so the
 * vertex/UV math is unit-tested headlessly while only the rasterised pixels stay human-gated.
 *
 * The original tiles each isometric cell from a `text_NNN` ground texture via two UV triangles; this
 * slice **approximates** that (a recorded deviation, docs/FIDELITY.md): every cell of a landscape
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

/**
 * The 4 diamond-corner positions (in projected world space, before the camera transform) for a cell
 * centred at `(sx, sy)`, in `[top, right, bottom, left]` order — the same diamond the flat-tint
 * `tileGraphic` traces (`center ± TILE_HALF`), returned as a flat `[x0,y0, x1,y1, …]` vertex buffer.
 */
export function diamondCorners(sx: number, sy: number): readonly number[] {
  return [
    sx,
    sy - TILE_HALF_H, // top
    sx + TILE_HALF_W,
    sy, // right
    sx,
    sy + TILE_HALF_H, // bottom
    sx - TILE_HALF_W,
    sy, // left
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

/**
 * One triangle's 3 vertex positions for a cell centred at `(sx, sy)`: the diamond corners named by
 * `cornerIndices` (one of {@link TRIANGLE_A_CORNERS} / {@link TRIANGLE_B_CORNERS}), as a flat
 * `[x0,y0, x1,y1, x2,y2]` buffer in UV-point order.
 */
export function triangleCorners(sx: number, sy: number, cornerIndices: readonly number[]): number[] {
  const diamond = diamondCorners(sx, sy);
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
