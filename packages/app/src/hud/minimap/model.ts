import {
  FOG_EXPLORED_ALPHA,
  FOG_UNEXPLORED_ALPHA,
  type Viewport,
  type WorldBounds,
} from '@open-northland/render';
import { FOG_STATE, scanChangedBytes } from '@open-northland/sim';
import { contains, type Rect } from '../geometry.js';
import { navBeamRect } from '../nav-beam.js';
import { centralRegion, SELECTION_PANEL_W, TOP_BAR_HEIGHT } from '../regions.js';
import { MIN_UI_SCALE } from '../ui-scale.js';

/**
 * The pure half of the minimap window: layout, the world↔minimap projection, the raster writes and the
 * camera-viewport rectangle. "World" here is the renderer's projected px space before the camera
 * transform. Terrain, dots and the camera rectangle use the same uniform scale as the world view.
 */

export const ATLAS_WIDTHS = { s: 224, m: 280, l: 344, xl: 416, xxl: 496 } as const;
export type MinimapSize = keyof typeof ATLAS_WIDTHS;
const SIZES = Object.keys(ATLAS_WIDTHS) as readonly MinimapSize[];

const BORDER = 20;
const MIN_PANEL_SIDE = 124;
// Limit the trim to one third of a side; fixed-size corner slices remain intact.
const MAX_FRAME_ASPECT = 1.5;
const NAV_GAP = 6;
const TOP_SAFE = 70;
const SELECTION_GAP = 12;
/** Design px between the top bar and the overview's frame, whose title rises above it. */
const OVERVIEW_TOP_GAP = 14;
/** Design px of the overview's band round the map: a window's slim frame. */
const OVERVIEW_BORDER = 8;
/** The overview's share of the screen's width: large, with the world still in view around it. */
const OVERVIEW_WIDTH_SHARE = 0.8;
/** Design px the unknown-location strip hangs below the overview's frame. */
const OVERVIEW_STRIP_OVERHANG = 24;

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

/**
 * The next size that is larger on this screen. The bottom navigation and the selection panel cap the
 * width, so a size that would clamp to the current one is skipped and the cycle wraps to the smallest.
 */
export function nextMinimapSize(
  current: MinimapSize,
  bounds: WorldBounds,
  screenH: number,
  uiscale: number,
  screenW: number,
): MinimapSize {
  const width = (size: MinimapSize): number => minimapLayout(bounds, screenH, uiscale, size, screenW).panel.w;
  const now = width(current);
  return SIZES.slice(SIZES.indexOf(current) + 1).find((size) => width(size) > now) ?? 's';
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
  return framedLayout(atlasPanel(bounds, screenH, screenW, artScale, size), bounds, artScale, BORDER);
}

/**
 * The largest frame hugging the whole map under the top bar and above the navigation beam, within its
 * share of the screen's width, on the beam's axis. It stands over the HUD's columns and the corner map,
 * like a window; the world keeps showing around it.
 */
export function overviewLayout(
  bounds: WorldBounds,
  screenH: number,
  uiscale: number,
  screenW: number,
): MinimapLayout {
  const artScale = Math.max(MIN_UI_SCALE, uiscale);
  const region = centralRegion({ width: screenW, height: screenH }, artScale);
  const border = 2 * OVERVIEW_BORDER * artScale;
  const top = (TOP_BAR_HEIGHT + OVERVIEW_TOP_GAP) * artScale;
  const roomH = region.y + region.h - OVERVIEW_STRIP_OVERHANG * artScale - top;
  const fit = Math.min(
    (screenW * OVERVIEW_WIDTH_SHARE - border) / bounds.width,
    (roomH - border) / bounds.height,
  );
  if (fit <= 0) return framedLayout({ x: 0, y: screenH, w: 0, h: 0 }, bounds, artScale, OVERVIEW_BORDER);
  const w = bounds.width * fit + border;
  const h = bounds.height * fit + border;
  const panel = { x: (screenW - w) / 2, y: top + (roomH - h) / 2, w, h };
  return framedLayout(panel, bounds, artScale, OVERVIEW_BORDER);
}

function framedLayout(panel: Rect, bounds: WorldBounds, artScale: number, rail: number): MinimapLayout {
  const border = Math.min(rail * artScale, panel.w / 2);
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

/** Whether a `Uint32Array` over RGBA bytes holds red in its low byte, as on every common platform. */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const BYTE_BITS = 8;
const OPAQUE_ALPHA = 0xff;

/** `0xRRGGBB` as the opaque RGBA pixel a `Uint32Array` over the raster's bytes stores. */
export function opaquePixelWord(colour: number): number {
  const r = (colour >> (2 * BYTE_BITS)) & 0xff;
  const g = (colour >> BYTE_BITS) & 0xff;
  const b = colour & 0xff;
  return LITTLE_ENDIAN
    ? ((OPAQUE_ALPHA << (3 * BYTE_BITS)) | (b << (2 * BYTE_BITS)) | (g << BYTE_BITS) | r) >>> 0
    : ((r << (3 * BYTE_BITS)) | (g << (2 * BYTE_BITS)) | (b << BYTE_BITS) | OPAQUE_ALPHA) >>> 0;
}

const WORDS = new WeakMap<Uint8Array, Uint32Array>();

/** One word per RGBA pixel over `rgba`'s bytes, so a stamp writes a pixel in one store, not four. */
export function pixelWordsOf(rgba: Uint8Array): Uint32Array {
  let words = WORDS.get(rgba);
  if (words === undefined) {
    words = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / Uint32Array.BYTES_PER_ELEMENT);
    WORDS.set(rgba, words);
  }
  return words;
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
  const words = pixelWordsOf(rgba);
  const word = opaquePixelWord(colour);
  for (let y = y0; y < y1; y++)
    for (let at = y * pxW + x0, end = y * pxW + x1; at < end; at++) words[at] = word;
}

/** The `FogView` slice the mask raster reads. */
export interface FogCells {
  readonly cellsWide: number;
  readonly cellsHigh: number;
  readonly stateAt: (cellX: number, cellY: number) => number;
}

/** Unexplored ground under the minimap mask: a dark, slightly warm slate instead of black, so the
 *  explored map emerges from darkness against the frame's wood rather than from a hole. A tuned look. */
export const FOG_UNEXPLORED_TINT = 0x1a1713;

const RGBA = 4;

/** The premultiplied mask pixel of one fog state: alpha graded with the render layer's alphas, explored
 *  ground dimmed by black and unexplored ground covered in {@link FOG_UNEXPLORED_TINT}. */
function writeFogPixel(rgba: Uint8Array, cell: number, state: number): void {
  const o = cell * RGBA;
  const unexplored = state !== FOG_STATE.VISIBLE && state !== FOG_STATE.EXPLORED;
  rgba[o] = unexplored ? FOG_TINT_R : 0;
  rgba[o + 1] = unexplored ? FOG_TINT_G : 0;
  rgba[o + 2] = unexplored ? FOG_TINT_B : 0;
  rgba[o + 3] =
    state === FOG_STATE.VISIBLE
      ? 0
      : state === FOG_STATE.EXPLORED
        ? FOG_EXPLORED_ALPHA
        : FOG_UNEXPLORED_ALPHA;
}

const premultipliedTint = (shift: number): number =>
  Math.round((((FOG_UNEXPLORED_TINT >> shift) & 0xff) * FOG_UNEXPLORED_ALPHA) / 0xff);
const FOG_TINT_R = premultipliedTint(2 * BYTE_BITS);
const FOG_TINT_G = premultipliedTint(BYTE_BITS);
const FOG_TINT_B = premultipliedTint(0);

/** Write one premultiplied fog mask into `rgba` (`cellsWide × cellsHigh`, row-major, 4 bytes/px). */
export function fillFogMask(fog: FogCells, rgba: Uint8Array): void {
  for (let r = 0; r < fog.cellsHigh; r++) {
    for (let c = 0; c < fog.cellsWide; c++) writeFogPixel(rgba, r * fog.cellsWide + c, fog.stateAt(c, r));
  }
}

/** Rewrite the mask pixels of the cells whose bytes differ between the mask copies `before` and `after`
 *  (`fog`'s), read under one mode, where equal bytes read equal states; false when nothing changed. */
export function refillChangedFogCells(
  fog: FogCells,
  before: Uint8Array,
  after: Uint8Array,
  rgba: Uint8Array,
): boolean {
  let changed = false;
  scanChangedBytes(before, after, (cell) => {
    const c = cell % fog.cellsWide;
    writeFogPixel(rgba, cell, fog.stateAt(c, (cell - c) / fog.cellsWide));
    changed = true;
    return true;
  });
  return changed;
}
