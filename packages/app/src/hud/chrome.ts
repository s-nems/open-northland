import type { Graphics } from 'pixi.js';
import type { Rect } from './geometry.js';

/**
 * The shared parchment look of the HUD's pop-up windows (building menu, statistics, placement banner)
 * plus the hover/selection highlight theme — ONE home so the chrome can't drift per window. The pop-up
 * chrome here is a flat `Graphics` panel (no decoded art), but it is styled to READ like the original's
 * wood window: a warm-brown body inside a two-tone bevel, a rust headline band, raised/pressed buttons,
 * and a recessed scrollbar. The details panel (`details-panel/chrome.ts`) draws the higher-fidelity
 * original-art rope-and-knot borders + tiled `bg*.pcx` fills; when the tool-panel windows adopt THAT look,
 * lift those helpers up here rather than forking them.
 */

/** Design-space window metrics (scaled by uiscale, like the strip): padding, title row, text line. */
export const WIN_PAD = 6;
export const WIN_TITLE_H = 16;
export const WIN_LINE_H = 12;

/** Parchment window fill/border. */
export const WINDOW_FILL = 0x241d12;
export const WINDOW_BORDER = 0x6b5836;
/** The two-tone bevel: a warm highlight on the light edge, near-black on the shadow edge. */
const BEVEL_LIGHT = 0x8a744a;
const BEVEL_DARK = 0x120d07;
/** Rust headline band (the title bar) + the dark line that separates it from the body. */
const HEADLINE_FILL = 0x3a2a18;
const HEADLINE_EDGE = 0x120d07;
/** Tab faces: a slightly lit body for the selected (pressed-in) tab, a duller one for the rest. */
const TAB_FILL = 0x2c2114;
const TAB_SELECTED_FILL = 0x4a3720;
/** Alternating list-row tint (every other row) for a quiet ledger stripe on the wood. */
export const ROW_STRIPE = 0x2b2216;
/** Scrollbar: a recessed track and a raised thumb. */
const SCROLL_TRACK = 0x161009;
const SCROLL_THUMB = 0x6b5836;
/** The close-box X stroke. */
const CLOSE_X_COLOR = 0xd8ccb0;
/** The close-box backdrop dim. */
const CLOSE_BOX_ALPHA = 0.3;

/** Hover highlight tint + strength over a flat button/row (the strip buttons, menu tabs, list rows). */
export const HOVER_TINT = 0xffffff;
export const HOVER_ALPHA = 0.16;
/** Selected-tab highlight strength (slightly quieter than hover so the two read differently). */
export const SELECT_ALPHA = 0.14;

/** One scaled bevel line width (design px → screen px, floored to a visible minimum). */
const bevelLine = (scale: number): number => Math.max(1, Math.round(scale));

/**
 * Draw a two-tone bevel INSIDE `r`: light edges top+left, dark edges bottom+right for a RAISED look;
 * swapped for a PRESSED (inset) look. The shared primitive behind the panel frame, tab buttons and the
 * scrollbar thumb/track, so every recessed/raised affordance reads consistently.
 */
export function drawBevel(g: Graphics, r: Rect, scale: number, style: 'raised' | 'pressed'): void {
  const w = bevelLine(scale);
  const light = style === 'raised' ? BEVEL_LIGHT : BEVEL_DARK;
  const dark = style === 'raised' ? BEVEL_DARK : BEVEL_LIGHT;
  // Top + left (the "light" pair for a raised control).
  g.rect(r.x, r.y, r.w, w).fill(light);
  g.rect(r.x, r.y, w, r.h).fill(light);
  // Bottom + right (the "dark" pair).
  g.rect(r.x, r.y + r.h - w, r.w, w).fill(dark);
  g.rect(r.x + r.w - w, r.y, w, r.h).fill(dark);
}

/** Draw the standard parchment window panel: wood fill + outer border + a raised inner bevel. */
export function drawWindowPanel(g: Graphics, r: Rect, scale: number): void {
  g.rect(r.x, r.y, r.w, r.h)
    .fill(WINDOW_FILL)
    .stroke({ color: WINDOW_BORDER, width: bevelLine(scale) });
  drawBevel(g, r, scale, 'raised');
}

/** Draw the rust headline band across `r`, with a dark separator line under it (title text drawn by the caller). */
export function drawHeadlineBar(g: Graphics, r: Rect, scale: number): void {
  g.rect(r.x, r.y, r.w, r.h).fill(HEADLINE_FILL);
  g.rect(r.x, r.y + r.h - bevelLine(scale), r.w, bevelLine(scale)).fill(HEADLINE_EDGE);
}

/**
 * Draw a category-tab button: a pressed (lit, inset) face for the selected tab, a raised (dull) face for
 * the rest — the original's tabs read as one pushed-in and the others standing proud.
 */
export function drawTabButton(g: Graphics, r: Rect, scale: number, selected: boolean): void {
  g.rect(r.x, r.y, r.w, r.h).fill(selected ? TAB_SELECTED_FILL : TAB_FILL);
  drawBevel(g, r, scale, selected ? 'pressed' : 'raised');
}

/** Draw the vertical scrollbar: a recessed track with a raised thumb. */
export function drawScrollbar(g: Graphics, track: Rect, thumb: Rect, scale: number): void {
  g.rect(track.x, track.y, track.w, track.h).fill(SCROLL_TRACK);
  drawBevel(g, track, scale, 'pressed');
  g.rect(thumb.x, thumb.y, thumb.w, thumb.h).fill(SCROLL_THUMB);
  drawBevel(g, thumb, scale, 'raised');
}

/** Fill `r` with the alternating list-row stripe (used on every other row). */
export function drawRowStripe(g: Graphics, r: Rect): void {
  g.rect(r.x, r.y, r.w, r.h).fill(ROW_STRIPE);
}

/** Fill `r` with the hover highlight (a light wash over a button/row/tab under the cursor). */
export function drawHoverHighlight(g: Graphics, r: Rect): void {
  g.rect(r.x, r.y, r.w, r.h).fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
}

/** Draw the close affordance (a dimmed box with an X) into `r` — the top-right close hot-region. */
export function drawCloseX(g: Graphics, r: Rect, scale: number): void {
  const m = Math.max(2, 2 * scale);
  g.rect(r.x, r.y, r.w, r.h)
    .fill({ color: 0x000000, alpha: CLOSE_BOX_ALPHA })
    .stroke({ color: WINDOW_BORDER, width: Math.max(1, scale) })
    .moveTo(r.x + m, r.y + m)
    .lineTo(r.x + r.w - m, r.y + r.h - m)
    .moveTo(r.x + r.w - m, r.y + m)
    .lineTo(r.x + m, r.y + r.h - m)
    .stroke({ color: CLOSE_X_COLOR, width: Math.max(1, scale) });
}
