import type { Rect } from '../geometry.js';
import type { ScreenSize } from '../nav-beam.js';
import { bottomReserveFor, centralWindowFloor, centralWindowOrigin } from '../regions.js';
import { MIN_UI_SCALE } from '../ui-scale.js';

/** Where the legacy pop-ups stand on the redesigned HUD: the central window region (`hud/regions.ts`),
 *  read against the live screen because every window rebuilds on a resize. */
export interface ToolPanelLayout {
  /** The scale actually applied: floored at `MIN_UI_SCALE`, may be fractional. */
  readonly scale: number;
  /** Where a central window `width` screen px wide opens. */
  windowOrigin(screen: ScreenSize, width: number): { readonly x: number; readonly y: number };
  /** The lowest y a central window may reach before the navigation beam. */
  windowFloor(screen: ScreenSize): number;
  /** The bottom-edge reserve a window spanning `x..x+w` keeps clear of: the beam, or `overlay` (the
   *  minimap) where the span crosses that instead. */
  bottomReserve(
    screen: ScreenSize,
    span: { readonly x: number; readonly w: number },
    overlay: Rect | null,
  ): Rect | null;
  /** The screen area a screen-centred sheet (the mission window) centres in: above the beam. */
  sheetArea(screen: ScreenSize): ScreenSize;
}

export function buildToolPanelLayout(uiscale: number): ToolPanelLayout {
  const scale = Math.max(MIN_UI_SCALE, uiscale);
  return {
    scale,
    windowOrigin: (screen, width) => centralWindowOrigin(screen, scale, width),
    windowFloor: (screen) => centralWindowFloor(screen, scale),
    bottomReserve: (screen, span, overlay) => bottomReserveFor(screen, scale, span, overlay),
    sheetArea: (screen) => ({ width: screen.width, height: centralWindowFloor(screen, scale) }),
  };
}
