import { type Container, type Graphics, type Texture, TilingSprite } from 'pixi.js';
import type { Rect } from './geometry.js';

/**
 * The shared chrome of the HUD's pop-up windows (building menu, statistics, placement banner) plus the
 * hover highlight theme — ONE home so the look can't drift per window. It offers two tiers over the same
 * geometry: {@link tileBitmap} lays the decoded `bg*.pcx` wood/rust/button fills (the in-game look), and
 * the `draw*` Graphics helpers (gilt frame, bevels, tab plates, scrollbar) both frame those tiles AND
 * stand in as the flat fallback when `content/` is absent. The details panel (`details-panel/chrome.ts`)
 * draws the higher-fidelity rope-and-knot borders over the same bitmap fills; its rope-frame helpers are
 * the remaining thing to lift up here (rather than fork) when these windows want that border too.
 */

/** Design-space window metrics (scaled by uiscale, like the strip): padding, title row, text line. */
export const WIN_PAD = 6;
export const WIN_TITLE_H = 16;
export const WIN_LINE_H = 12;

/** Parchment window fill/border. */
export const WINDOW_FILL = 0x241d12;
export const WINDOW_BORDER = 0x6b5836;
/** Warmer wood fill used when the decoded `bg` bitmap is absent — closer to the in-game window than the
 *  near-black {@link WINDOW_FILL}, so the flat-Graphics fallback still reads as wood. */
export const WOOD_FILL = 0x3a2c1a;
/** The gold window frame (a bright bead between two dark lines) echoing the original's gilt border. */
const FRAME_GOLD = 0xb79860;
const FRAME_DARK = 0x120d07;
/** The two-tone bevel: a warm highlight on the light edge, near-black on the shadow edge. */
const BEVEL_LIGHT = 0x8a744a;
const BEVEL_DARK = 0x120d07;
/** Rust headline band (the title bar) fill — the fallback when the decoded headline bitmap is absent. */
export const HEADLINE_FILL = 0x3a2a18;
/** Tab faces: a slightly lit body for the selected (pressed-in) tab, a duller one for the rest. */
const TAB_FILL = 0x2c2114;
const TAB_SELECTED_FILL = 0x4a3720;
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

/**
 * Tile `texture` over `r` into `target` at the panel scale (the original bitmap fills are 300×300 wood/rust
 * tiles). Returns false when the texture is absent so the caller draws a flat-Graphics fallback. Mirrors the
 * details panel's `tile` — the shared way both pop-up families reuse the decoded `bg*.pcx` fills.
 */
export function tileBitmap(target: Container, texture: Texture | undefined, r: Rect, scale: number): boolean {
  if (texture === undefined) return false;
  const sprite = new TilingSprite({
    texture,
    width: Math.max(1, Math.round(r.w)),
    height: Math.max(1, Math.round(r.h)),
  });
  sprite.position.set(Math.round(r.x), Math.round(r.y));
  sprite.tileScale.set(scale);
  target.addChild(sprite);
  return true;
}

/** Draw the gilt window frame around `r`: a bright gold bead between two dark lines (a flat evocation of the
 *  original's gilded rope border — the higher-fidelity rope art stays in the details panel). */
export function drawWindowFrame(g: Graphics, r: Rect, scale: number): void {
  const w = bevelLine(scale);
  g.rect(r.x, r.y, r.w, r.h).stroke({ color: FRAME_DARK, width: w, alignment: 0 });
  g.rect(r.x + w, r.y + w, r.w - 2 * w, r.h - 2 * w).stroke({ color: FRAME_GOLD, width: w, alignment: 0 });
  g.rect(r.x + 2 * w, r.y + 2 * w, r.w - 4 * w, r.h - 4 * w).stroke({
    color: FRAME_DARK,
    width: w,
    alignment: 0,
  });
}

/** A thin gold outline around a button/tab plate (the original's pale button edging). */
export function drawPlateOutline(g: Graphics, r: Rect, scale: number): void {
  g.rect(r.x, r.y, r.w, r.h).stroke({ color: FRAME_GOLD, width: bevelLine(scale), alignment: 0 });
}

/**
 * Draw a category-tab button (the flat fallback when the decoded button bitmap is absent): a pressed (lit,
 * inset) face for the selected tab, a raised (dull) face for the rest.
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
