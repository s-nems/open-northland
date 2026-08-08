import type { Container, Graphics } from 'pixi.js';
import {
  drawBevel,
  drawCloseX,
  drawHoverHighlight,
  drawPlateOutline,
  drawScrollbar,
  drawTabButton,
  drawWindowFrame,
  HEADLINE_FILL,
  tileBitmap,
  WOOD_FILL,
} from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { TextRun } from '../../text-run.js';
import type { PanelContext } from '../context.js';
import type { TabbedListItem, TabbedListLayout, TabbedListRow } from './model.js';

/** Drawing and run placement for a tabbed-list window; the controller owns state, input and lifecycle. */

/** Text sizes (design px). */
const TITLE_PX = 13;
const TAB_PX = 11;
const ROW_PX = 11;
/** Approximate cap height (design px) of the body text, for vertically centring a run in a chrome rect. */
const TEXT_CAP_H = 10;
/** Left inset (design px) of a row label inside its button-card. */
const ROW_INSET_X = 8;
/** Vertical inset (design px) of a card inside its row slot. */
const CARD_INSET_Y = 2;
/** Inset (design px) of the headline strip inside the window frame, so the frame reads around it. */
const HEADLINE_INSET = 2;

/** The layers a tabbed-list window paints into. */
export interface TabbedListLayers {
  readonly ctx: PanelContext;
  readonly container: Container;
  /** Tiled bitmap fills, drawn behind `graphics`. */
  readonly back: Container;
  readonly graphics: Graphics;
  /** The window's text runs, in draw order `[title, ...tabs, ...rows]`. */
  readonly runs: TextRun[];
}

/** The card plate inside a row slot, inset vertically so consecutive cards read as separate plates. */
export function cardRect(row: TabbedListRow<unknown>, scale: number): Rect {
  return {
    x: row.rect.x,
    y: Math.round(row.rect.y + CARD_INSET_Y * scale),
    w: row.rect.w,
    h: Math.round(row.rect.h - 2 * CARD_INSET_Y * scale),
  };
}

/** Destroy the tiled fills (the shell owns clearing `graphics` and the runs). */
export function clearFills(back: Container): void {
  for (const child of back.removeChildren()) child.destroy();
}

/** Paint the window and queue its text runs in the order `placeRuns` replays. */
export function paintWindow<Id, Item extends TabbedListItem>(
  layers: TabbedListLayers,
  layout: TabbedListLayout<Id, Item>,
  title: string,
): void {
  const { ctx, back, graphics } = layers;
  const { scale } = ctx;

  const addRun = (text: string, color: 'white' | 'dimmed', px: number): void => {
    const run = ctx.makeText(text, color, px);
    layers.container.addChild(run.container);
    layers.runs.push(run);
  };

  if (!tileBitmap(back, ctx.bitmaps.bg, layout.window, scale)) {
    graphics.rect(layout.window.x, layout.window.y, layout.window.w, layout.window.h).fill(WOOD_FILL);
  }
  drawWindowFrame(graphics, layout.window, scale);

  const inset = Math.round(HEADLINE_INSET * scale);
  const band: Rect = {
    x: layout.titleRect.x + inset,
    y: layout.titleRect.y + inset,
    w: layout.titleRect.w - 2 * inset,
    h: layout.titleRect.h - inset,
  };
  if (!tileBitmap(back, ctx.bitmaps.headline, band, scale)) {
    graphics.rect(band.x, band.y, band.w, band.h).fill(HEADLINE_FILL);
  }
  drawCloseX(graphics, layout.closeRect, scale);
  addRun(title, 'white', TITLE_PX);

  for (const tab of layout.tabs) {
    const tex = tab.selected ? ctx.bitmaps.buttonHilite : ctx.bitmaps.button;
    if (tileBitmap(back, tex, tab.rect, scale)) {
      drawPlateOutline(graphics, tab.rect, scale);
      if (!tab.selected) drawBevel(graphics, tab.rect, scale, 'pressed'); // recede the inactive tabs
    } else {
      drawTabButton(graphics, tab.rect, scale, tab.selected);
    }
    const label =
      tab.stringId === undefined ? tab.label : ctx.uiString('miscwindow', tab.stringId, tab.label);
    addRun(label, tab.selected ? 'white' : 'dimmed', TAB_PX);
  }
  for (const row of layout.rows) {
    const card = cardRect(row, scale);
    if (!tileBitmap(back, ctx.bitmaps.button, card, scale)) drawTabButton(graphics, card, scale, false);
    drawPlateOutline(graphics, card, scale);
    addRun(row.item.label, 'white', ROW_PX);
  }
  if (layout.scrollbar !== undefined) {
    drawScrollbar(graphics, layout.scrollbar.track, layout.scrollbar.thumb, scale);
  }
}

/** Position the queued runs: title and tabs centred in their rects, row labels left-inset in their cards. */
export function placeRuns<Id, Item extends TabbedListItem>(
  layers: TabbedListLayers,
  layout: TabbedListLayout<Id, Item>,
): void {
  const { ctx, runs } = layers;
  const { scale } = ctx;
  const { width: rw, height: rh } = ctx.screen();

  const centre = (run: TextRun, rect: Rect): void => {
    const x = rect.x + Math.max(0, (rect.w - run.width * scale) / 2);
    run.place(Math.round(x), Math.round(rect.y + (rect.h - TEXT_CAP_H * scale) / 2), scale, rw, rh);
  };

  let i = 0;
  const title = runs[i++];
  if (title !== undefined) centre(title, layout.titleRect);
  for (const tab of layout.tabs) {
    const run = runs[i++];
    if (run !== undefined) centre(run, tab.rect);
  }
  for (const row of layout.rows) {
    const run = runs[i++];
    if (run === undefined) continue;
    const card = cardRect(row, scale);
    const y = card.y + (card.h - TEXT_CAP_H * scale) / 2;
    run.place(Math.round(card.x + ROW_INSET_X * scale), Math.round(y), scale, rw, rh);
  }
}

/** Redraw only the hover wash over `hovered`'s card, leaving the painted chrome untouched. */
export function paintHover<Id, Item extends TabbedListItem>(
  hover: Graphics,
  layout: TabbedListLayout<Id, Item> | null,
  hovered: Item | null,
  scale: number,
): void {
  hover.clear();
  if (layout === null || hovered === null) return;
  const row = layout.rows.find((r) => r.item === hovered);
  if (row !== undefined) drawHoverHighlight(hover, cardRect(row, scale));
}
