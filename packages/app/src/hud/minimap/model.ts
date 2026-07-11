import { TILE_HALF_H, TILE_HALF_W, type Viewport } from '@vinland/render';
import { type Rect, contains } from '../geometry.js';

/**
 * The pure half of the minimap (no Pixi, no DOM — headlessly unit-tested): the bottom-left layout,
 * the world↔minimap linear projection, the terrain colour raster and the camera-viewport rectangle.
 * "World" here is the renderer's projected px space BEFORE the camera transform (`tileToScreen` /
 * `screen = world*scale + offset` — see render's `iso.ts`), so the minimap is a uniform downscale of
 * the on-screen world: clicks, dots and the view rectangle all share ONE linear mapping.
 */

/** The box the minimap must fit in (px), preserving the world's aspect — a 256² map fills it. */
export const MINIMAP_MAX_W = 240;
export const MINIMAP_MAX_H = 150;
/** px inset from the screen's bottom-left corner. */
export const MINIMAP_MARGIN = 12;

/** The world-space (projected px, pre-camera) axis-aligned bounds of a whole terrain grid. */
export interface WorldBounds {
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The world box covering every cell DIAMOND of a `mapW × mapH` cell grid. Centres span
 * `x ∈ [0, (2·mapW−1)·TILE_HALF_W]` (odd rows staggered half a cell right), `y ∈ [0, (mapH−1)·TILE_HALF_H]`;
 * each diamond extends ±TILE_HALF_W / ±TILE_HALF_H around its centre.
 */
export function terrainWorldBounds(mapW: number, mapH: number): WorldBounds {
  return {
    minX: -TILE_HALF_W,
    minY: -TILE_HALF_H,
    width: (2 * mapW + 1) * TILE_HALF_W,
    height: (mapH + 1) * TILE_HALF_H,
  };
}

/** The minimap's on-screen rect + the world→minimap px scale (uniform — aspect preserved). */
export interface MinimapLayout {
  readonly rect: Rect;
  /** Minimap px per world px. */
  readonly scale: number;
}

/**
 * Fit the world bounds into the {@link MINIMAP_MAX_W}×{@link MINIMAP_MAX_H} box (uniform scale, so the
 * map never distorts) and anchor the result at the screen's bottom-left, {@link MINIMAP_MARGIN} in.
 * Only the screen HEIGHT matters (the left inset is fixed); recomputed per frame from the live screen
 * size (the tool-panel convention — no resize listener).
 */
export function minimapLayout(bounds: WorldBounds, screenH: number): MinimapLayout {
  const scale = Math.min(MINIMAP_MAX_W / bounds.width, MINIMAP_MAX_H / bounds.height);
  const w = bounds.width * scale;
  const h = bounds.height * scale;
  return { rect: { x: MINIMAP_MARGIN, y: screenH - MINIMAP_MARGIN - h, w, h }, scale };
}

/** World point → absolute screen px on the minimap (may fall outside `rect` for an off-map point). */
export function worldToMinimap(
  layout: MinimapLayout,
  bounds: WorldBounds,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return {
    x: layout.rect.x + (wx - bounds.minX) * layout.scale,
    y: layout.rect.y + (wy - bounds.minY) * layout.scale,
  };
}

/** Absolute screen px on the minimap → the world point it depicts (the click-to-jump inverse). */
export function minimapToWorld(
  layout: MinimapLayout,
  bounds: WorldBounds,
  mx: number,
  my: number,
): { x: number; y: number } {
  return {
    x: bounds.minX + (mx - layout.rect.x) / layout.scale,
    y: bounds.minY + (my - layout.rect.y) / layout.scale,
  };
}

/** True when the absolute screen point lies on the minimap (the pointer-claim test). */
export function pointOverMinimap(layout: MinimapLayout, x: number, y: number): boolean {
  return contains(layout.rect, x, y);
}

/**
 * The camera's visible world box as a minimap-local rect (relative to `rect.x/rect.y`), clamped to the
 * minimap so a half-off-map view draws a partial frame instead of bleeding outside the panel. Returns
 * null when the view lies entirely off the minimap.
 */
export function viewportRectOnMinimap(layout: MinimapLayout, bounds: WorldBounds, vp: Viewport): Rect | null {
  const x0 = Math.max(0, (vp.minX - bounds.minX) * layout.scale);
  const y0 = Math.max(0, (vp.minY - bounds.minY) * layout.scale);
  const x1 = Math.min(layout.rect.w, (vp.maxX - bounds.minX) * layout.scale);
  const y1 = Math.min(layout.rect.h, (vp.maxY - bounds.minY) * layout.scale);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** The cell grid the raster samples — the render `SceneTerrain` sub-shape it actually reads. */
export interface TerrainCells {
  readonly width: number;
  readonly height: number;
  readonly typeIds: readonly number[];
}

/**
 * Rasterize the whole terrain into an RGBA byte grid (`pxW × pxH`, row-major, 4 bytes/px) — built ONCE
 * per map (terrain is static) and uploaded as the minimap's ground texture. Each pixel samples the cell
 * DIAMOND containing its world point: candidate centres on the two nearest rows (odd rows staggered half
 * a cell right, matching `tileToScreen`), picked by the diamond metric `|dx|/TILE_HALF_W + |dy|/TILE_HALF_H`
 * (≤ 1 ⇔ inside the diamond — the diamonds tile the plane, so the minimum IS the containing cell).
 * `colourOf` misses fall back to `fallback` (the render flat-tint palette).
 */
export function rasterizeTerrain(
  terrain: TerrainCells,
  colourOf: (typeId: number) => number | undefined,
  fallback: (typeId: number) => number,
  pxW: number,
  pxH: number,
): Uint8Array {
  const bounds = terrainWorldBounds(terrain.width, terrain.height);
  const out = new Uint8Array(pxW * pxH * 4);
  for (let py = 0; py < pxH; py++) {
    const wy = bounds.minY + ((py + 0.5) / pxH) * bounds.height;
    // The two rows whose diamonds can contain this y (rows interlock at half-diamond spacing).
    const rowLo = Math.floor(wy / TILE_HALF_H);
    for (let px = 0; px < pxW; px++) {
      const wx = bounds.minX + ((px + 0.5) / pxW) * bounds.width;
      let bestCol = 0;
      let bestRow = 0;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const row of [rowLo, rowLo + 1]) {
        const clampedRow = Math.min(terrain.height - 1, Math.max(0, row));
        const stagger = clampedRow % 2 === 0 ? 0 : 1; // odd rows sit half a cell right (tileToScreen)
        const col = Math.min(terrain.width - 1, Math.max(0, Math.round((wx / TILE_HALF_W - stagger) / 2)));
        const cx = (2 * col + stagger) * TILE_HALF_W;
        const cy = clampedRow * TILE_HALF_H;
        const dist = Math.abs(wx - cx) / TILE_HALF_W + Math.abs(wy - cy) / TILE_HALF_H;
        if (dist < bestDist) {
          bestDist = dist;
          bestCol = col;
          bestRow = clampedRow;
        }
      }
      const typeId = terrain.typeIds[bestRow * terrain.width + bestCol] ?? 0;
      const colour = colourOf(typeId) ?? fallback(typeId);
      const o = (py * pxW + px) * 4;
      out[o] = (colour >> 16) & 0xff;
      out[o + 1] = (colour >> 8) & 0xff;
      out[o + 2] = colour & 0xff;
      out[o + 3] = 0xff;
    }
  }
  return out;
}
