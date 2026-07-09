import type { Graphics } from 'pixi.js';
import type { Rect } from './geometry.js';

/**
 * The shared parchment look of the HUD's pop-up windows (building menu, statistics, placement banner)
 * plus the hover/selection highlight theme — ONE home so the chrome can't drift per window. The pop-up
 * chrome here is still a flat `Graphics` panel in both render modes; the details panel
 * (`details-panel/chrome.ts`) already draws the original-art rope-and-knot borders + tiled fills — when
 * the tool-panel windows adopt that look, lift those helpers up here rather than forking them.
 */

/** Design-space window metrics (scaled by uiscale, like the strip): padding, title row, text line. */
export const WIN_PAD = 6;
export const WIN_TITLE_H = 16;
export const WIN_LINE_H = 12;

/** Parchment window fill/border. */
export const WINDOW_FILL = 0x241d12;
export const WINDOW_BORDER = 0x6b5836;
/** The close-box X stroke. */
const CLOSE_X_COLOR = 0xd8ccb0;
/** The close-box backdrop dim. */
const CLOSE_BOX_ALPHA = 0.3;

/** Hover highlight tint + strength over a flat button/row (the strip buttons, menu tabs). */
export const HOVER_TINT = 0xffffff;
export const HOVER_ALPHA = 0.16;
/** Selected-tab highlight strength (slightly quieter than hover so the two read differently). */
export const SELECT_ALPHA = 0.14;

/** Draw the standard parchment window panel (fill + border) for `r`. */
export function drawWindowPanel(g: Graphics, r: Rect, scale: number): void {
  g.rect(r.x, r.y, r.w, r.h)
    .fill(WINDOW_FILL)
    .stroke({ color: WINDOW_BORDER, width: Math.max(1, scale) });
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
