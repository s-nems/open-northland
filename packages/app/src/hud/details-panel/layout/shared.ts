import { WIN_PAD } from '../../chrome.js';
import type { Rect } from '../../geometry.js';

// The panel-wide metrics and section/panel rect builders every kind's layout is measured from, so the
// height a section reserves and the rows it draws cannot drift apart. Metrics are design px, multiplied
// by uiscale at build time; each is an approximation measured from native 1024×768 original screenshots.

export const PANEL_W = 322;
/** Gap between the panel and the screen's right/bottom edge. */
const PANEL_MARGIN = 6;
/** Vertical gap between two section windows; the original stacks them flush, with adjacent rope borders
 *  touching and no parchment seam between. */
export const SECTION_GAP = 0;
/** The headline strip's height (fits the font-12 small-caps titles like the original). */
const TITLE_H = 18;
/** Vertical padding between a section's headline/body/end. */
const BODY_PAD_Y = 5;
/** A plain text row (key/value lines, worker rows). */
export const ROW_H = 15;
/** Top padding that vertically centers a font-10 line in a {@link ROW_H} row. */
export const ROW_TEXT_PAD = 2;

/** One section window: its whole frame, the headline strip, and the padded body below it. */
export interface SectionRect {
  readonly frame: Rect;
  readonly title: Rect;
  readonly body: Rect;
}

export function sectionAt(x: number, y: number, w: number, bodyH: number, s: number): SectionRect {
  const titleH = Math.round(TITLE_H * s);
  const pad = Math.round(BODY_PAD_Y * s);
  const frame: Rect = { x, y, w, h: titleH + pad + bodyH + pad };
  return {
    frame,
    title: { x, y, w, h: titleH },
    body: {
      x: x + Math.round(WIN_PAD * s),
      y: y + titleH + pad,
      w: w - 2 * Math.round(WIN_PAD * s),
      h: bodyH,
    },
  };
}

export function panelRect(totalH: number, screen: { width: number; height: number }, s: number): Rect {
  const w = Math.round(PANEL_W * s);
  const margin = Math.round(PANEL_MARGIN * s);
  return {
    x: Math.max(margin, screen.width - w - margin),
    y: Math.max(margin, screen.height - totalH - margin),
    w,
    h: totalH,
  };
}
