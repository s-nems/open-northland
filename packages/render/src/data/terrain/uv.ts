/**
 * The pattern-page UV fold: a pattern record's pixel coords, or a plain sub-rect, onto a cell's two
 * triangles. The convention is verified across all 927 pattern records and 38 transition records:
 * `coordsA` lists the tile square's (TL, BR, BL) and maps onto A's [apex, SE, SW]; `coordsB` lists
 * (TL, TR, BR) and maps onto B's [left, E, SE] - both in point order, divided by the page size
 * verbatim.
 */

/** A source sub-rectangle in texture pixels - the pattern's tile region within its `text_NNN` page. */
export interface SrcRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * The render-local ground binding for one landscape typeId. Declared structurally rather than imported:
 * the app derives it from a `TerrainPattern` IR row.
 */
export interface CellTexture {
  /** The texture page key (e.g. `text_003`) - the key into the loaded page sources. */
  readonly pageKey: string;
  /** The tile's sub-rect within the page, in texture pixels. */
  readonly rect: SrcRect;
  /** The logic-type `debugColor` as `0xRRGGBB` - the flat-tint fallback when the page is unavailable. */
  readonly fallbackColour?: number;
}

/**
 * One pattern triangle's 3 normalised UVs from its 6-int pixel-coord tuple (`coordsA`/`coordsB`), flat
 * `[u0,v0, u1,v1, u2,v2]` in the tuple's point order. The original's coords are inclusive pixel corners
 * (`0..63` for a 64px tile); the sub-texel difference is immaterial at tile scale, so the division is
 * straight.
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
 * A page sub-rect's corners folded onto one cell triangle by the pattern-record convention (`a` gets
 * the rect's TL, BR, BL; `b` its TL, TR, BR), so the approximated representative-tile path shares the
 * 1:1 path's tessellation and differs only in which sub-rect it samples.
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
 * of `coordsA ∪ coordsB` (each a `[x0,y0, x1,y1, x2,y2]` triple). For a representative full-tile
 * pattern this is the tile's 64×64 square within its page.
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

/** Texture page key from a `data/.../text_NNN.pcx` path: the basename without its extension
 *  (`text_NNN`) - the stem both the served `/textures/<key>.png` route and the pipeline's emitted
 *  page file carry. */
export function texturePageKey(texture: string): string {
  const base = texture.split('/').pop() ?? texture;
  return base.replace(/\.[^.]+$/, '');
}
