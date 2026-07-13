import { TILE_HALF_H, TILE_HALF_W, type Viewport } from '@open-northland/render';
import { contains, type Rect } from '../geometry.js';

/**
 * The pure half of the minimap (no Pixi, no DOM — headlessly unit-tested): the bottom-left window
 * layout inside the original braided frame, the world↔minimap linear projection, the terrain colour
 * raster and the camera-viewport rectangle. "World" here is the renderer's projected px space BEFORE
 * the camera transform (`tileToScreen` / `screen = world*scale + offset` — see render's `iso.ts`), so
 * the minimap is a uniform downscale of the on-screen world: clicks, dots and the view rectangle all
 * share ONE linear mapping.
 */

/**
 * The original overview-window frame's native geometry (source basis: MEASURED from the decoded
 * `ls_gui_window` bob 55 — the braided frame carries ornament along its top+right only and its hole
 * runs flush to the left/bottom edges, so the original pinned this window to the screen's bottom-left
 * corner exactly where ours sits). `inner` is the near-black map hole the picture draws in — a
 * ~square window, letterboxed when the map's aspect differs.
 */
export const FRAME_NATIVE = {
  w: 149,
  h: 133,
  inner: { x: 0, y: 16, w: 116, h: 117 },
} as const;

/**
 * Extra drawn px per native frame px at UI scale 1 — the knob that sizes the whole window. At the
 * default 1.4 UI scale the map hole comes out ≈244 px, a touch larger than the first iteration's
 * 240 px panel. NAMED DIVERGENCE: the original drew its GUI art 1:1, so this frame renders 1.5×
 * larger relative to the rest of the HUD than the original's proportions — a deliberate readability
 * choice for modern screen sizes (user-approved size).
 */
export const MINIMAP_ART_SCALE = 1.5;

/** The minimap window's screen layout, all rects in absolute screen px. */
export interface MinimapLayout {
  /** The whole framed window (the braided frame's outer box), pinned to the bottom-left corner. */
  readonly panel: Rect;
  /** The frame's map hole — the black window the ground/bars fill. */
  readonly inner: Rect;
  /** The map picture itself, aspect-fitted and centred inside `inner` (letterboxed bars around it). */
  readonly map: Rect;
  /** Minimap px per world px (uniform — the map never distorts). */
  readonly scale: number;
  /** Drawn px per native frame px — the frame art's placement scale. */
  readonly artScale: number;
}

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

/**
 * Lay the framed window out against the live screen: the frame is a FIXED size (native × `uiscale`,
 * clamped ≥1, × {@link MINIMAP_ART_SCALE}) pinned flush to the bottom-left corner (the original frame's
 * flush hole edges — see {@link FRAME_NATIVE}); the map is aspect-fitted into the hole with letterbox
 * bars. Only the screen HEIGHT matters; recomputed per frame (the tool-panel convention — no resize
 * listener).
 */
export function minimapLayout(bounds: WorldBounds, screenH: number, uiscale: number): MinimapLayout {
  const artScale = MINIMAP_ART_SCALE * Math.max(1, uiscale);
  const panel: Rect = {
    x: 0,
    y: screenH - FRAME_NATIVE.h * artScale,
    w: FRAME_NATIVE.w * artScale,
    h: FRAME_NATIVE.h * artScale,
  };
  const inner: Rect = {
    x: panel.x + FRAME_NATIVE.inner.x * artScale,
    y: panel.y + FRAME_NATIVE.inner.y * artScale,
    w: FRAME_NATIVE.inner.w * artScale,
    h: FRAME_NATIVE.inner.h * artScale,
  };
  const scale = Math.min(inner.w / bounds.width, inner.h / bounds.height);
  const map: Rect = {
    x: inner.x + (inner.w - bounds.width * scale) / 2,
    y: inner.y + (inner.h - bounds.height * scale) / 2,
    w: bounds.width * scale,
    h: bounds.height * scale,
  };
  return { panel, inner, map, scale, artScale };
}

/** World point → absolute screen px on the minimap (may fall outside the map rect for an off-map point). */
export function worldToMinimap(
  layout: MinimapLayout,
  bounds: WorldBounds,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return {
    x: layout.map.x + (wx - bounds.minX) * layout.scale,
    y: layout.map.y + (wy - bounds.minY) * layout.scale,
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
    x: bounds.minX + (mx - layout.map.x) / layout.scale,
    y: bounds.minY + (my - layout.map.y) / layout.scale,
  };
}

/** True when the absolute screen point lies on the framed window (the pointer-claim test). */
export function pointOverMinimap(layout: MinimapLayout, x: number, y: number): boolean {
  return contains(layout.panel, x, y);
}

/** True when the point lies in the map HOLE — where a click means "jump there" (braid clicks don't). */
export function pointOverMinimapHole(layout: MinimapLayout, x: number, y: number): boolean {
  return contains(layout.inner, x, y);
}

/**
 * The camera's visible world box as an absolute screen rect, clamped to the map picture so a
 * half-off-map view draws a partial frame instead of bleeding into the bars. Returns null when the
 * view lies entirely off the map.
 */
export function viewportRectOnMinimap(layout: MinimapLayout, bounds: WorldBounds, vp: Viewport): Rect | null {
  const x0 = Math.max(layout.map.x, layout.map.x + (vp.minX - bounds.minX) * layout.scale);
  const y0 = Math.max(layout.map.y, layout.map.y + (vp.minY - bounds.minY) * layout.scale);
  const x1 = Math.min(layout.map.x + layout.map.w, layout.map.x + (vp.maxX - bounds.minX) * layout.scale);
  const y1 = Math.min(layout.map.y + layout.map.h, layout.map.y + (vp.maxY - bounds.minY) * layout.scale);
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
 * `colourOfCell` maps the winning cell (row-major index + its typeId) to `0xRRGGBB`.
 */
export function rasterizeTerrain(
  terrain: TerrainCells,
  colourOfCell: (cell: number, typeId: number) => number,
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
      // The two candidate rows, unrolled (no per-pixel array) — this loop runs once per raster px.
      for (let candidate = 0; candidate < 2; candidate++) {
        const clampedRow = Math.min(terrain.height - 1, Math.max(0, rowLo + candidate));
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
      const cell = bestRow * terrain.width + bestCol;
      const colour = colourOfCell(cell, terrain.typeIds[cell] ?? 0);
      const o = (py * pxW + px) * 4;
      out[o] = (colour >> 16) & 0xff;
      out[o + 1] = (colour >> 8) & 0xff;
      out[o + 2] = colour & 0xff;
      out[o + 3] = 0xff;
    }
  }
  return out;
}
