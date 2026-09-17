import { panelSpanFromRight } from './details-panel/layout/shared.js';
import type { Rect } from './geometry.js';
import { minimapPanelWidth } from './minimap/model.js';
import { navBeamRect, type ScreenSize } from './nav-beam.js';

/**
 * The frozen HUD regions (FOUNDATION.md, "HUD shell") in design px, resolved to screen px at a HUD
 * scale. The left column is the notification column or the minimap, whichever reaches further right.
 */

export const NOTICE_COLUMN = { left: 10, top: 18, width: 180 } as const;
/** Top of the central window region, under the top bar. */
export const WINDOW_REGION_TOP = 96;
/** Breathing room between the central region and the regions around it. */
const REGION_GAP = 8;

/** The region a central window opens in: between the left column and the selection panel, from
 *  under the top bar down to the navigation beam. */
export function centralRegion(screen: ScreenSize, scale: number): Rect {
  const gap = REGION_GAP * scale;
  const left = Math.max((NOTICE_COLUMN.left + NOTICE_COLUMN.width) * scale, minimapPanelWidth(scale)) + gap;
  const right = screen.width - panelSpanFromRight(scale) - gap;
  const top = WINDOW_REGION_TOP * scale;
  const bottom = navBeamRect(screen, scale).y - gap;
  return { x: left, y: top, w: Math.max(0, right - left), h: Math.max(0, bottom - top) };
}

/** Where a central window `width` screen px wide opens: centred in the region, or on the screen when
 *  it is wider than the region. */
export function centralWindowOrigin(
  screen: ScreenSize,
  scale: number,
  width: number,
): { readonly x: number; readonly y: number } {
  const region = centralRegion(screen, scale);
  const x = width <= region.w ? region.x + (region.w - width) / 2 : Math.max(0, (screen.width - width) / 2);
  return { x: Math.round(x), y: Math.round(region.y) };
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
