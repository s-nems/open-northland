import type { HudLayout, HudTextRow } from './layout.js';

export type HudCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** px gap kept between the panel and the canvas edge it anchors to. */
const HUD_MARGIN = 8;

/** The canvas the panel is placed on, in pixels. */
export interface HudScreen {
  readonly width: number;
  readonly height: number;
}

export interface HudPlacement {
  /** Panel top-left x in canvas pixels. */
  readonly panelX: number;
  /** Panel top-left y in canvas pixels. */
  readonly panelY: number;
  /** Panel size in canvas pixels. */
  readonly width: number;
  readonly height: number;
  /** The text rows with absolute screen `(x, y)`. */
  readonly rows: readonly HudTextRow[];
}

/**
 * Place a laid-out {@link HudLayout} at a screen {@link HudCorner}, converting panel-relative rows to
 * absolute canvas pixels and clamping so the whole panel stays on-screen.
 */
export function placeHud(layout: HudLayout, corner: HudCorner, screen: HudScreen): HudPlacement {
  const right = corner === 'top-right' || corner === 'bottom-right';
  const bottom = corner === 'bottom-left' || corner === 'bottom-right';

  const rawX = right ? screen.width - layout.width - HUD_MARGIN : HUD_MARGIN;
  const rawY = bottom ? screen.height - layout.height - HUD_MARGIN : HUD_MARGIN;
  // When the panel is larger than the canvas the outer `Math.max` wins, keeping the top/left edge
  // on-screen rather than the bottom/right.
  const panelX = Math.max(0, Math.min(rawX, screen.width - layout.width));
  const panelY = Math.max(0, Math.min(rawY, screen.height - layout.height));

  const rows: HudTextRow[] = layout.rows.map((r) => ({ x: panelX + r.x, y: panelY + r.y, text: r.text }));
  return { panelX, panelY, width: layout.width, height: layout.height, rows };
}
