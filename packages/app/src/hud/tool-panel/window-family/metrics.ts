import { MIN_UI_SCALE } from '../../ui-scale.js';

/**
 * Design-px metrics of the titled pop-up window family, scaled by uiscale. Approximation: the original's
 * window metrics are not decoded, so these are the build menu's proportions adopted as the shared set,
 * and only the label widths they must clear are measured.
 */

export const WINDOW_FAMILY_PAD = 6;
/** The rust title band across the top of the window. */
export const HEADLINE_H = 18;
export const TAB_H = 18;
/** Each item sits on its own button-card, so the row slot is taller than a plain text line. */
export const ROW_H = 20;
/** A small gap between the tab grid and whatever content sits under it. */
export const TAB_CONTENT_GAP = 3;
export const CLOSE_BOX = 13;
/** The width seed, not a laid-out size: the column the widest tab label must clear, measured as 55 px
 *  for "Wszystko" in the original's font10 face, plus padding. Actual tabs are `contentWidth /
 *  tabColumns` wide. */
const TAB_COLUMN_W = 62;
/** How many seed columns the window holds - the build menu's five categories, its widest tab grid. */
const WIDTH_COLUMNS = 5;
const WINDOW_W = WIDTH_COLUMNS * TAB_COLUMN_W + 2 * WINDOW_FAMILY_PAD;

/** The family's standard window width in screen px, fixed per scale so a controller knows its x-span
 *  before it has a layout. */
export function standardWindowWidth(scale: number): number {
  return Math.round(WINDOW_W * Math.max(MIN_UI_SCALE, scale));
}
