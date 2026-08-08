import { type Container, type Graphics, type Texture, TilingSprite } from 'pixi.js';
import type { Rect } from './geometry.js';

/**
 * The shared chrome of the HUD's pop-up windows plus the hover highlight theme. Two tiers over the same
 * geometry: `tileBitmap` lays the decoded `bg*.pcx` wood/rust/button fills, and the `draw*` Graphics
 * helpers both frame those tiles and stand in as the flat fallback when `content/` is absent.
 */

/** Design-space window metrics (scaled by uiscale, like the strip): padding, title row, text line. */
export const WIN_PAD = 6;
export const WIN_TITLE_H = 16;
export const WIN_LINE_H = 12;

const WINDOW_FILL = 0x241d12;
export const WINDOW_BORDER = 0x6b5836;
/** The wood fill drawn when the decoded `bg` bitmap is absent, so the flat fallback still reads as wood. */
export const WOOD_FILL = 0x3a2c1a;
const FRAME_GOLD = 0xb79860;
const FRAME_DARK = 0x120d07;
const BEVEL_LIGHT = 0x8a744a;
const BEVEL_DARK = 0x120d07;
/** Rust headline band (the title bar) fill - the fallback when the decoded headline bitmap is absent. */
export const HEADLINE_FILL = 0x3a2a18;
const TAB_FILL = 0x2c2114;
const TAB_SELECTED_FILL = 0x4a3720;
const SCROLL_TRACK = 0x161009;
const SCROLL_THUMB = 0x6b5836;
/** The pale control-glyph stroke: the close-box X and the extras window's −/+ steppers. */
export const CLOSE_X_COLOR = 0xd8ccb0;
const CLOSE_BOX_ALPHA = 0.3;

/** Hover highlight tint + strength over a flat button, row, or tab. */
export const HOVER_TINT = 0xffffff;
export const HOVER_ALPHA = 0.16;

/** One scaled bevel line width (design px → screen px, floored to a visible minimum). */
const bevelLine = (scale: number): number => Math.max(1, Math.round(scale));

/**
 * Draw a two-tone bevel inside `r`: light edges top and left, dark edges bottom and right for a raised
 * look, swapped for a pressed one.
 */
export function drawBevel(g: Graphics, r: Rect, scale: number, style: 'raised' | 'pressed'): void {
  const w = bevelLine(scale);
  const light = style === 'raised' ? BEVEL_LIGHT : BEVEL_DARK;
  const dark = style === 'raised' ? BEVEL_DARK : BEVEL_LIGHT;
  g.rect(r.x, r.y, r.w, w).fill(light);
  g.rect(r.x, r.y, w, r.h).fill(light);
  g.rect(r.x, r.y + r.h - w, r.w, w).fill(dark);
  g.rect(r.x + r.w - w, r.y, w, r.h).fill(dark);
}

/** Draw the standard parchment window panel: fill, outer border, raised inner bevel. */
export function drawWindowPanel(g: Graphics, r: Rect, scale: number): void {
  g.rect(r.x, r.y, r.w, r.h)
    .fill(WINDOW_FILL)
    .stroke({ color: WINDOW_BORDER, width: bevelLine(scale) });
  drawBevel(g, r, scale, 'raised');
}

/**
 * Tile `texture` over `r` into `target` at the panel scale (the original bitmap fills are 300×300 wood/rust
 * tiles). Returns false when the texture is absent so the caller draws a flat-Graphics fallback.
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

/** Draw the gilt window frame around `r`: a bright gold bead between two dark lines, a flat evocation of
 *  the original's gilded rope border (approximation). */
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

/** Draw a category-tab button: the flat fallback when the decoded button bitmap is absent. */
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

/** Fill `r` with the hover highlight: a light wash over the control under the cursor. */
export function drawHoverHighlight(g: Graphics, r: Rect): void {
  g.rect(r.x, r.y, r.w, r.h).fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
}

/** Draw the close affordance into `r`: a dimmed box with an X. */
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
