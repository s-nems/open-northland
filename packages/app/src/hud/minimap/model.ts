import {
  FOG_EXPLORED_ALPHA,
  FOG_UNEXPLORED_ALPHA,
  type Viewport,
  type WorldBounds,
} from '@open-northland/render';
import { FOG_STATE } from '@open-northland/sim';
import { contains, type Rect } from '../geometry.js';
import { navBeamRect } from '../nav-beam.js';
import { SELECTION_PANEL_W } from '../regions.js';
import { MIN_UI_SCALE } from '../ui-scale.js';

/**
 * The pure half of the minimap window: layout, the world↔minimap projection, the raster writes and the
 * camera-viewport rectangle. "World" here is the renderer's projected px space before the camera
 * transform. Terrain, dots and the camera rectangle use the same uniform scale as the world view.
 */

export const ATLAS_WIDTHS = { s: 224, m: 280, l: 344, xl: 416 } as const;
export type MinimapSize = keyof typeof ATLAS_WIDTHS;

const BORDER = 20;
const MIN_PANEL_SIDE = 124;
// Limit the trim to one third of a side; fixed-size corner slices remain intact.
const MAX_FRAME_ASPECT = 1.5;
const NAV_GAP = 6;
const TOP_SAFE = 70;
const SELECTION_GAP = 12;

/** Outer geometry in screen px; an impossibly small screen collapses the available map area. */
function atlasPanel(
  bounds: WorldBounds,
  screenH: number,
  screenW: number,
  artScale: number,
  size: MinimapSize,
): Rect {
  const besideNavigation = navBeamRect({ width: screenW, height: screenH }, artScale).x - NAV_GAP * artScale;
  const besideSelection = screenW - (SELECTION_GAP + SELECTION_PANEL_W) * artScale;
  const top = Math.min(TOP_SAFE * artScale, Math.max(0, screenH));
  const available = Math.max(
    0,
    Math.min(ATLAS_WIDTHS[size] * artScale, besideNavigation, besideSelection, screenH - top),
  );
  const side = available >= MIN_PANEL_SIDE * artScale ? available : 0;
  if (side === 0) return { x: 0, y: screenH, w: 0, h: 0 };
  const border = 2 * BORDER * artScale;
  const fit = (side - border) / Math.max(bounds.width, bounds.height);
  const minimum = Math.max(MIN_PANEL_SIDE * artScale, side / MAX_FRAME_ASPECT);
  const w = Math.min(side, Math.max(minimum, bounds.width * fit + border));
  const h = Math.min(side, Math.max(minimum, bounds.height * fit + border));
  return { x: 0, y: screenH - h, w, h };
}

/** Panel width in screen px before a narrow screen limits it. */
export function minimapPanelWidth(uiscale: number, size: MinimapSize = 'm'): number {
  return ATLAS_WIDTHS[size] * Math.max(MIN_UI_SCALE, uiscale);
}

/** Screen-px geometry. At zoom > 1, `map` may extend outside the clipped `inner` region. */
export interface MinimapLayout {
  readonly panel: Rect;
  readonly inner: Rect;
  readonly map: Rect;
  /** Minimap px per projected world px; zero only when no map area fits on the screen. */
  readonly scaleX: number;
  readonly scaleY: number;
  /** Drawn px per HUD design px. */
  readonly artScale: number;
}

/** Anchor the map at the bottom-left, beside the bottom navigation, preserving geography through narrow and short screens. */
export function minimapLayout(
  bounds: WorldBounds,
  screenH: number,
  uiscale: number,
  size: MinimapSize = 'm',
  screenW: number = Number.POSITIVE_INFINITY,
): MinimapLayout {
  const artScale = Math.max(MIN_UI_SCALE, uiscale);
  const panel = atlasPanel(bounds, screenH, screenW, artScale, size);
  const border = Math.min(BORDER * artScale, panel.w / 2);
  const inner: Rect = {
    x: panel.x + border,
    y: panel.y + border,
    w: Math.max(0, panel.w - 2 * border),
    h: Math.max(0, panel.h - 2 * border),
  };
  const scaleX = Math.min(inner.w / bounds.width, inner.h / bounds.height);
  const scaleY = scaleX;
  const map: Rect = {
    x: inner.x + (inner.w - bounds.width * scaleX) / 2,
    y: inner.y + (inner.h - bounds.height * scaleY) / 2,
    w: bounds.width * scaleX,
    h: bounds.height * scaleY,
  };
  return { panel, inner, map, scaleX, scaleY, artScale };
}

/** The visible terrain window; parchment fills the remainder of the inner frame. */
export function visibleMinimapRect(layout: MinimapLayout): Rect {
  const { inner, map } = layout;
  const x = Math.max(inner.x, map.x);
  const y = Math.max(inner.y, map.y);
  return {
    x,
    y,
    w: Math.max(0, Math.min(inner.x + inner.w, map.x + map.w) - x),
    h: Math.max(0, Math.min(inner.y + inner.h, map.y + map.h) - y),
  };
}

/** A zoom axis stays centred while letterboxed and cannot expose blank space when larger than the hole. */
function zoomAxis(origin: number, size: number, mapSize: number, target: number): number {
  if (mapSize <= size) return origin + (size - mapSize) / 2;
  return Math.max(origin + size - mapSize, Math.min(origin, target));
}

/** Zoom the whole-world layout independently of the world camera; pass the unzoomed base each time. */
export function zoomMinimapLayout(
  base: MinimapLayout,
  bounds: WorldBounds,
  zoom: number,
  center: { readonly x: number; readonly y: number },
): MinimapLayout {
  const factor = Number.isNaN(zoom) ? 1 : Math.min(4, Math.max(1, zoom));
  if (factor === 1) return base;
  const scaleX = base.scaleX * factor;
  const scaleY = base.scaleY * factor;
  const w = bounds.width * scaleX;
  const h = bounds.height * scaleY;
  const { inner } = base;
  const x = zoomAxis(inner.x, inner.w, w, inner.x + inner.w / 2 - (center.x - bounds.minX) * scaleX);
  const y = zoomAxis(inner.y, inner.h, h, inner.y + inner.h / 2 - (center.y - bounds.minY) * scaleY);
  return { ...base, scaleX, scaleY, map: { x, y, w, h } };
}

/** World point → absolute screen px on the minimap (may fall outside the map rect for an off-map point). */
export function worldToMinimap(
  layout: MinimapLayout,
  bounds: WorldBounds,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return {
    x: layout.map.x + (wx - bounds.minX) * layout.scaleX,
    y: layout.map.y + (wy - bounds.minY) * layout.scaleY,
  };
}

/** Absolute screen px on the minimap → the world point it depicts (the click-to-jump inverse). */
export function minimapToWorld(
  layout: MinimapLayout,
  bounds: WorldBounds,
  mx: number,
  my: number,
): { x: number; y: number } {
  if (layout.scaleX === 0 || layout.scaleY === 0)
    return { x: bounds.minX + bounds.width / 2, y: bounds.minY + bounds.height / 2 };
  return {
    x: bounds.minX + (mx - layout.map.x) / layout.scaleX,
    y: bounds.minY + (my - layout.map.y) / layout.scaleY,
  };
}

/** True when the absolute screen point lies on the framed window (the pointer-claim test). */
export function pointOverMinimap(layout: MinimapLayout, x: number, y: number): boolean {
  return contains(layout.panel, x, y);
}

/** True when the point lies in the map hole - where a click means "jump there" (chrome clicks do not). */
export function pointOverMinimapHole(layout: MinimapLayout, x: number, y: number): boolean {
  return contains(layout.inner, x, y);
}

/**
 * The camera's visible world box as an absolute screen rect, clipped to the map picture and its hole.
 * Returns null when the camera is outside the visible map fragment.
 */
export function viewportRectOnMinimap(layout: MinimapLayout, bounds: WorldBounds, vp: Viewport): Rect | null {
  const x0 = Math.max(layout.inner.x, layout.map.x, layout.map.x + (vp.minX - bounds.minX) * layout.scaleX);
  const y0 = Math.max(layout.inner.y, layout.map.y, layout.map.y + (vp.minY - bounds.minY) * layout.scaleY);
  const x1 = Math.min(
    layout.inner.x + layout.inner.w,
    layout.map.x + layout.map.w,
    layout.map.x + (vp.maxX - bounds.minX) * layout.scaleX,
  );
  const y1 = Math.min(
    layout.inner.y + layout.inner.h,
    layout.map.y + layout.map.h,
    layout.map.y + (vp.maxY - bounds.minY) * layout.scaleY,
  );
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Stamp one opaque dot centred on `cx, cy` into an RGBA raster, clipped to
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
