import {
  FOG_EXPLORED_ALPHA,
  FOG_UNEXPLORED_ALPHA,
  type Viewport,
  type WorldBounds,
} from '@open-northland/render';
import { FOG_STATE } from '@open-northland/sim';
import { contains, type Rect } from '../geometry.js';
import { MIN_UI_SCALE } from '../ui-scale.js';

/**
 * The pure half of the minimap window: layout, the world↔minimap projection, the raster writes and the
 * camera-viewport rectangle. "World" here is the renderer's projected px space before the camera
 * transform, so clicks, dots and the view rectangle all share one uniform downscale of the on-screen
 * world.
 */

/**
 * The original overview-window frame's native geometry, measured from the decoded `ls_gui_window` bob
 * 55: the braid carries ornament along its top and right only and its hole runs flush to the left and
 * bottom edges, which is why the window pins to the screen's bottom-left corner. `inner` is the
 * near-black map hole, letterboxed when the map's aspect differs.
 */
export const FRAME_NATIVE = {
  w: 149,
  h: 133,
  inner: { x: 0, y: 16, w: 116, h: 117 },
} as const;

/**
 * Extra drawn px per native frame px at UI scale 1, the knob that sizes the whole window. Named
 * deviation: the original drew its GUI art 1:1, so this frame renders 1.5× larger relative to the rest
 * of the HUD, a readability choice for modern screen sizes.
 */
export const MINIMAP_ART_SCALE = 1.5;

/** Drawn px per native frame px at a UI scale; a scale under the floor draws as the floor. */
function minimapArtScale(uiscale: number): number {
  return MINIMAP_ART_SCALE * Math.max(MIN_UI_SCALE, uiscale);
}

/** The framed window's width in screen px, for HUD that sits beside it along the bottom edge. */
export function minimapPanelWidth(uiscale: number): number {
  return FRAME_NATIVE.w * minimapArtScale(uiscale);
}

/**
 * The framed window's box in HUD design px, for DOM regions laid out on the plane: the native frame
 * at the art scale, pinned flush to the plane's bottom-left corner. The frame scales with the HUD, so
 * the design-px box holds at every HUD scale the settings can reach; a `?uiscale=` under
 * `MIN_UI_SCALE` draws it larger than this, since `minimapArtScale` floors the scale.
 */
export function minimapDesignBox(planeHeight: number): Rect {
  const w = FRAME_NATIVE.w * MINIMAP_ART_SCALE;
  const h = FRAME_NATIVE.h * MINIMAP_ART_SCALE;
  return { x: 0, y: planeHeight - h, w, h };
}

/** The minimap window's screen layout, all rects in absolute screen px. */
export interface MinimapLayout {
  /** The whole framed window (the braided frame's outer box), pinned to the bottom-left corner. */
  readonly panel: Rect;
  /** The frame's map hole - the black window the ground/bars fill. */
  readonly inner: Rect;
  /** The map picture itself, aspect-fitted and centred inside `inner` (letterboxed bars around it). */
  readonly map: Rect;
  /** Minimap px per world px (uniform - the map never distorts). */
  readonly scale: number;
  /** Drawn px per native frame px - the frame art's placement scale. */
  readonly artScale: number;
}

/**
 * Lay the framed window out against the live screen: a fixed-size frame pinned flush to the bottom-left
 * corner, with the map aspect-fitted into the hole between letterbox bars. Only the screen height
 * matters, and it is recomputed per frame rather than through a resize listener.
 */
export function minimapLayout(bounds: WorldBounds, screenH: number, uiscale: number): MinimapLayout {
  const artScale = minimapArtScale(uiscale);
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

/** True when the point lies in the map hole - where a click means "jump there" (braid clicks don't). */
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

/**
 * Stamp one opaque square dot (`2·half` px a side, centred on `cx, cy`) into an RGBA raster, clipped to
 * the buffer edges. Stamping into one retained buffer avoids a Graphics rebuild, which would
 * re-tessellate hundreds of dot rects and allocate on every tick.
 */
export function stampDot(
  rgba: Uint8Array,
  pxW: number,
  pxH: number,
  cx: number,
  cy: number,
  half: number,
  colour: number,
): void {
  const x0 = Math.max(0, Math.round(cx - half));
  const y0 = Math.max(0, Math.round(cy - half));
  const x1 = Math.min(pxW, Math.round(cx + half));
  const y1 = Math.min(pxH, Math.round(cy + half));
  const r = (colour >> 16) & 0xff;
  const g = (colour >> 8) & 0xff;
  const b = colour & 0xff;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const o = (y * pxW + x) * 4;
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 0xff;
    }
  }
}

/** The `FogView` slice the mask raster reads. */
export interface FogCells {
  readonly cellsWide: number;
  readonly cellsHigh: number;
  readonly stateAt: (cellX: number, cellY: number) => number;
}

/**
 * Write one fog mask into `rgba` (`cellsWide × cellsHigh`, row-major, 4 bytes/px): only the alpha lane,
 * graded by state with the render layer's alphas, so the caller keeps the rgb lanes black.
 */
export function fillFogAlpha(fog: FogCells, rgba: Uint8Array): void {
  for (let r = 0; r < fog.cellsHigh; r++) {
    for (let c = 0; c < fog.cellsWide; c++) {
      const state = fog.stateAt(c, r);
      rgba[(r * fog.cellsWide + c) * 4 + 3] =
        state === FOG_STATE.VISIBLE
          ? 0
          : state === FOG_STATE.EXPLORED
            ? FOG_EXPLORED_ALPHA
            : FOG_UNEXPLORED_ALPHA;
    }
  }
}
