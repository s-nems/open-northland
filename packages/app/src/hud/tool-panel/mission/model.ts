import { contains, type Rect } from '../../geometry.js';
import { MIN_UI_SCALE } from '../../ui-scale.js';
import { CLOSE_BOX } from '../window-family/metrics.js';

/**
 * The mission window's geometry: the original's large papyrus sheet (`ls_gui_window` frame 25, 610×549)
 * centred on the screen, or as much of it as fits. Content insets are an approximation of the sheet's
 * rolled margins, since the original's text rectangle is not decoded.
 */

/** The papyrus sheet's native size (design px). */
export const MISSION_SHEET_W = 610;
export const MISSION_SHEET_H = 549;
/** Screen margin the sheet keeps from the edges (design px). */
const SCREEN_MARGIN = 8;
/** Content insets inside the sheet (design px). */
const INSET_X = 48;
const INSET_TOP = 38;
const INSET_BOTTOM = 40;
/** The close box sits tucked into the sheet's top-right margin (design px). */
const CLOSE_INSET = 18;
/** The OK plate (design px) on the sheet's bottom margin. */
const OK_W = 84;
const OK_H = 20;
const OK_GAP = 8;
/** Scrollbar column reserved at the content's right edge (design px). */
export const SCROLLBAR_W = 8;
const SCROLLBAR_GAP = 6;

export const MISSION_TITLE_PX = 16;
export const MISSION_HEADING_PX = 13;
export const MISSION_BODY_PX = 12;
/** Vertical rhythm (design px). */
export const TITLE_GAP = 10;
export const PARAGRAPH_GAP = 6;
export const SECTION_GAP = 12;
/** One wheel notch scrolls this many design px. */
export const WHEEL_STEP = 28;
/** The scrollbar thumb never shrinks below this (design px), so a long text keeps a grabbable thumb. */
const MIN_THUMB_H = 12;

export interface MissionWindowLayout {
  readonly scale: number;
  /** The sheet's on-screen rect; the papyrus frame is drawn stretched into it. */
  readonly window: Rect;
  /** The sheet scale relative to its native size, for drawing the frame. */
  readonly sheetScale: number;
  readonly closeRect: Rect;
  readonly okRect: Rect;
  /** The scrolling text viewport, above the OK plate. */
  readonly viewport: Rect;
  /** The wrap width the text runs take (design px, pre-scale). */
  readonly wrapWidth: number;
  readonly scrollbar: Rect;
}

export interface MissionLayoutOptions {
  readonly scale: number;
  readonly screen: { readonly width: number; readonly height: number };
  /** The tool-panel strip's screen width, which the sheet stays clear of. */
  readonly stripWidth: number;
}

export function layoutMissionWindow(opts: MissionLayoutOptions): MissionWindowLayout {
  const scale = Math.max(MIN_UI_SCALE, opts.scale);
  const px = (v: number): number => Math.round(v * scale);
  const margin = px(SCREEN_MARGIN);
  const freeW = Math.max(1, opts.screen.width - opts.stripWidth - 2 * margin);
  const freeH = Math.max(1, opts.screen.height - 2 * margin);
  // Keep the sheet's aspect: the frame art scales uniformly.
  const sheetScale = Math.min(scale, freeW / MISSION_SHEET_W, freeH / MISSION_SHEET_H);
  const w = Math.round(MISSION_SHEET_W * sheetScale);
  const h = Math.round(MISSION_SHEET_H * sheetScale);
  const x = Math.round(opts.stripWidth + margin + (freeW - w) / 2);
  const y = Math.round(margin + (freeH - h) / 2);
  const window: Rect = { x, y, w, h };

  const sp = (v: number): number => Math.round(v * sheetScale);
  const closeRect: Rect = {
    x: x + w - sp(CLOSE_INSET) - px(CLOSE_BOX),
    y: y + sp(CLOSE_INSET),
    w: px(CLOSE_BOX),
    h: px(CLOSE_BOX),
  };
  const okRect: Rect = {
    x: Math.round(x + (w - px(OK_W)) / 2),
    y: y + h - sp(INSET_BOTTOM) - px(OK_H),
    w: px(OK_W),
    h: px(OK_H),
  };
  const contentX = x + sp(INSET_X);
  const contentW = w - 2 * sp(INSET_X);
  const viewportY = y + sp(INSET_TOP);
  const viewport: Rect = {
    x: contentX,
    y: viewportY,
    w: contentW - px(SCROLLBAR_W + SCROLLBAR_GAP),
    h: Math.max(1, okRect.y - px(OK_GAP) - viewportY),
  };
  const scrollbar: Rect = {
    x: contentX + contentW - px(SCROLLBAR_W),
    y: viewport.y,
    w: px(SCROLLBAR_W),
    h: viewport.h,
  };
  return {
    scale,
    window,
    sheetScale,
    closeRect,
    okRect,
    viewport,
    wrapWidth: Math.max(1, Math.floor(viewport.w / scale)),
    scrollbar,
  };
}

export type MissionHit = { readonly kind: 'close' } | { readonly kind: 'window' } | null;

/** The close box and the OK plate both dismiss the window; anywhere else on the sheet is consumed. */
export function hitTestMissionWindow(layout: MissionWindowLayout, x: number, y: number): MissionHit {
  if (contains(layout.closeRect, x, y) || contains(layout.okRect, x, y)) return { kind: 'close' };
  if (contains(layout.window, x, y)) return { kind: 'window' };
  return null;
}

/** The scroll offset clamped to what the content can scroll by; zero when it fits. */
export function clampScroll(offset: number, contentHeight: number, viewportHeight: number): number {
  const max = Math.max(0, contentHeight - viewportHeight);
  return Math.min(max, Math.max(0, offset));
}

/** The scrollbar thumb for `offset`, or null when the content fits the viewport. */
export function scrollThumb(
  track: Rect,
  offset: number,
  contentHeight: number,
  viewportHeight: number,
  scale: number,
): Rect | null {
  if (contentHeight <= viewportHeight) return null;
  const visible = viewportHeight / contentHeight;
  const thumbH = Math.max(Math.round(track.h * visible), Math.min(track.h, Math.round(MIN_THUMB_H * scale)));
  const travel = track.h - thumbH;
  const max = contentHeight - viewportHeight;
  return { x: track.x, y: Math.round(track.y + (travel * offset) / max), w: track.w, h: thumbH };
}
