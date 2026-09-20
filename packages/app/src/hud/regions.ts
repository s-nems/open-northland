import type { Rect } from './geometry.js';
import { navBeamRect, type ScreenSize } from './nav-beam.js';

/**
 * The frozen HUD regions (FOUNDATION.md, "HUD shell") in design px, resolved to screen px at a HUD
 * scale.
 */

export const NOTICE_COLUMN = { left: 10, top: 18, width: 173 } as const;
/** The top-right bar's height: the `.on-panel` 1 px border and the `.on-bar` 6 px padding around its
 *  tallest child, the 34 px menu medallion. */
export const TOP_BAR_HEIGHT = 48;
/** Top of the central window region, under the top bar. */
export const WINDOW_REGION_TOP = 96;
/** Breathing room between the central region's floor and the navigation beam. */
const REGION_GAP = 8;

/** The region a central window opens in: the screen's width, from under the top bar down to the
 *  navigation beam. */
export function centralRegion(screen: ScreenSize, scale: number): Rect {
  const top = WINDOW_REGION_TOP * scale;
  const bottom = navBeamRect(screen, scale).y - REGION_GAP * scale;
  return { x: 0, y: top, w: screen.width, h: Math.max(0, bottom - top) };
}

/** Where a central window `width` screen px wide opens: on the screen's vertical axis, the beam's,
 *  at the region's top. */
export function centralWindowOrigin(
  screen: ScreenSize,
  scale: number,
  width: number,
): { readonly x: number; readonly y: number } {
  const region = centralRegion(screen, scale);
  return { x: Math.round(Math.max(0, (screen.width - width) / 2)), y: Math.round(region.y) };
}

/**
 * Where a central window `width` design px wide opens and how tall it may grow: on the screen's
 * vertical axis, at the region's top, its foot above the navigation beam. A window whose span would
 * cross `overlay` (the minimap) slides right until it clears it, because the DOM plane takes every
 * press inside whatever it covers and the corner below is the minimap's; it never leaves the screen
 * to do so.
 */
export function centralWindowBox(
  screen: ScreenSize,
  scale: number,
  width: number,
  overlay: Rect | null,
): { readonly x: number; readonly y: number; readonly maxHeight: number } {
  const region = centralRegion(screen, scale);
  const floor = region.y + region.h;
  const drawn = width * scale;
  const centred = centralWindowOrigin(screen, scale, drawn).x;
  const clear =
    overlay !== null && overlay.y < floor ? Math.max(centred, Math.ceil(overlay.x + overlay.w)) : centred;
  const y = Math.round(region.y);
  return {
    x: Math.round(Math.min(clear, Math.max(0, screen.width - drawn))),
    y,
    maxHeight: Math.max(0, floor - y),
  };
}

/** The lowest y a central window may reach before the navigation beam. */
export function centralWindowFloor(screen: ScreenSize, scale: number): number {
  const region = centralRegion(screen, scale);
  return region.y + region.h;
}

/** The top a window of `height` takes so its foot stays above `floor`: lifted from `top`, never above
 *  `minTop`. */
export function liftedTop(top: number, height: number, floor: number, minTop: number): number {
  return Math.max(minTop, Math.min(top, floor - height));
}

/** The bottom-edge reserve a window spanning `x..x+w` must keep clear of: the beam, or `overlay` (the
 *  minimap) when the span crosses that instead; the taller one when it crosses both. */
export function bottomReserveFor(
  screen: ScreenSize,
  scale: number,
  span: { readonly x: number; readonly w: number },
  overlay: Rect | null,
): Rect | null {
  const crosses = (r: Rect): boolean => span.x < r.x + r.w && span.x + span.w > r.x;
  const candidates = [navBeamRect(screen, scale), ...(overlay === null ? [] : [overlay])].filter(crosses);
  if (candidates.length === 0) return null;
  return candidates.reduce((tallest, r) => (r.y < tallest.y ? r : tallest));
}
