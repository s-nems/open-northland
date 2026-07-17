import type { HudLayout, HudTextRow } from './layout.js';

/**
 * The HUD panel's screen placement: a panel-relative {@link HudLayout} anchored to a canvas corner and
 * clamped on-screen. Pure — no Pixi, no glyph metrics.
 */

/** Which screen corner {@link placeHud} anchors the panel to (then insets by {@link HUD_MARGIN}). */
export type HudCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** px gap kept between the panel and the canvas edge it anchors to. */
const HUD_MARGIN = 8;

/** The canvas the panel is placed on — only its pixel size matters for corner anchoring + clamping. */
export interface HudScreen {
  readonly width: number;
  readonly height: number;
}

/**
 * A {@link HudLayout} placed at an absolute screen position — the panel's top-left corner in canvas
 * pixels plus every row's text re-anchored to absolute screen coordinates. The Pixi draw
 * (`renderHud`) consumes this and creates one display object per element.
 */
export interface HudPlacement {
  /** Panel top-left x in canvas pixels (after corner-anchoring + on-screen clamp). */
  readonly panelX: number;
  /** Panel top-left y in canvas pixels. */
  readonly panelY: number;
  /** Panel width in pixels (carried through from the layout — a fixed column). */
  readonly width: number;
  /** Panel height in pixels (carried through from the layout — grows with the row count). */
  readonly height: number;
  /** The text rows with absolute screen `(x, y)` (panel origin + the layout's panel-relative offset). */
  readonly rows: readonly HudTextRow[];
}

/**
 * Place a laid-out {@link HudLayout} at a screen {@link HudCorner}, converting panel-relative layout
 * to absolute canvas pixels. It (1) picks the panel's top-left from the corner plus a
 * {@link HUD_MARGIN} edge inset, (2) clamps it so the whole panel stays on-screen even if the canvas
 * is smaller than the panel, and (3) re-anchors every row's panel-relative `(x, y)` to that origin.
 *
 * A function of layout + corner + screen size alone (no Pixi, no glyph metrics), so the same inputs
 * place byte-identically every call.
 */
export function placeHud(layout: HudLayout, corner: HudCorner, screen: HudScreen): HudPlacement {
  const right = corner === 'top-right' || corner === 'bottom-right';
  const bottom = corner === 'bottom-left' || corner === 'bottom-right';

  // Anchor to the chosen corner, inset by the margin; then clamp into [0, screen − panel] so the whole
  // panel stays visible. `Math.max(0, …)` wins the clamp when the panel is taller/wider than the canvas
  // (the top/left edge is kept on-screen rather than the bottom/right) — a deterministic tie-break.
  const rawX = right ? screen.width - layout.width - HUD_MARGIN : HUD_MARGIN;
  const rawY = bottom ? screen.height - layout.height - HUD_MARGIN : HUD_MARGIN;
  const panelX = Math.max(0, Math.min(rawX, screen.width - layout.width));
  const panelY = Math.max(0, Math.min(rawY, screen.height - layout.height));

  const rows: HudTextRow[] = layout.rows.map((r) => ({ x: panelX + r.x, y: panelY + r.y, text: r.text }));
  return { panelX, panelY, width: layout.width, height: layout.height, rows };
}
