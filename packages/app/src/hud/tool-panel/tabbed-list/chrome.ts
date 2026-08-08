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
import type { TabbedListItem, TabbedListLayout } from './model.js';

/** Drawing and run placement for the titled tab-grid window family; the controllers own state, input
 *  and lifecycle. The tabbed lists paint rows and a scrollbar on top of the shared part. */

/** Text sizes (design px). */
const TITLE_PX = 13;
const TAB_PX = 11;
const ROW_PX = 11;
/** Approximate cap height (design px) of the body text, for vertically centring a run in a chrome rect. */
export const TEXT_CAP_H = 10;
/** Left inset (design px) of a row label inside its button-card. */
export const ROW_INSET_X = 8;
/** Vertical inset (design px) of a card inside its row slot. */
const CARD_INSET_Y = 2;
/** Inset (design px) of the headline strip inside the window frame, so the frame reads around it. */
const HEADLINE_INSET = 2;

/** The layers a family window paints into. */
export interface TabbedListLayers {
  readonly ctx: PanelContext;
  readonly container: Container;
  /** Tiled bitmap fills, drawn behind `graphics`. */
  readonly back: Container;
  readonly graphics: Graphics;
  /** The window's text runs, placed as they are queued; the shell destroys them on clear. */
  readonly runs: TextRun[];
}

/** One tab as the shared painter draws it: rect, pressed state, and its resolved label. */
export interface TitledTab {
  readonly rect: Rect;
  readonly selected: boolean;
  readonly label: string;
}

/** Place `run` centred in `rect` (the title and tab-label rule of the family). */
function centreRun(ctx: PanelContext, run: TextRun, rect: Rect): void {
  const { scale } = ctx;
  const { width: rw, height: rh } = ctx.screen();
  const x = rect.x + Math.max(0, (rect.w - run.width * scale) / 2);
  run.place(Math.round(x), Math.round(rect.y + (rect.h - TEXT_CAP_H * scale) / 2), scale, rw, rh);
}

/**
 * Paint the shared window part - wood fill, gilt frame, headline band, close box, centred title, and
 * the tab grid with centred labels - queueing and placing each run as it goes.
 */
export function paintTitledTabWindow(
  layers: TabbedListLayers,
  frame: { readonly window: Rect; readonly titleRect: Rect; readonly closeRect: Rect },
  tabs: readonly TitledTab[],
  title: string,
): void {
  const { ctx, back, graphics } = layers;
  const { scale } = ctx;

  const addRun = (text: string, color: 'white' | 'dimmed', px: number): TextRun => {
    const run = ctx.makeText(text, color, px);
    layers.container.addChild(run.container);
    layers.runs.push(run);
    return run;
  };

  if (!tileBitmap(back, ctx.bitmaps.bg, frame.window, scale)) {
    graphics.rect(frame.window.x, frame.window.y, frame.window.w, frame.window.h).fill(WOOD_FILL);
  }
  drawWindowFrame(graphics, frame.window, scale);

  const inset = Math.round(HEADLINE_INSET * scale);
  const band: Rect = {
    x: frame.titleRect.x + inset,
    y: frame.titleRect.y + inset,
    w: frame.titleRect.w - 2 * inset,
    h: frame.titleRect.h - inset,
  };
  if (!tileBitmap(back, ctx.bitmaps.headline, band, scale)) {
    graphics.rect(band.x, band.y, band.w, band.h).fill(HEADLINE_FILL);
  }
  drawCloseX(graphics, frame.closeRect, scale);
  centreRun(ctx, addRun(title, 'white', TITLE_PX), frame.titleRect);

  for (const tab of tabs) {
    const tex = tab.selected ? ctx.bitmaps.buttonHilite : ctx.bitmaps.button;
    if (tileBitmap(back, tex, tab.rect, scale)) {
      drawPlateOutline(graphics, tab.rect, scale);
      if (!tab.selected) drawBevel(graphics, tab.rect, scale, 'pressed'); // recede the inactive tabs
    } else {
      drawTabButton(graphics, tab.rect, scale, tab.selected);
    }
    centreRun(ctx, addRun(tab.label, tab.selected ? 'white' : 'dimmed', TAB_PX), tab.rect);
  }
}

/** The card plate inside a row slot, inset vertically so consecutive cards read as separate plates. */
function cardRect(slot: Rect, scale: number): Rect {
  return {
    x: slot.x,
    y: Math.round(slot.y + CARD_INSET_Y * scale),
    w: slot.w,
    h: Math.round(slot.h - 2 * CARD_INSET_Y * scale),
  };
}

/** Paint the family button-card inside a row slot and return the card rect for content placement. */
export function paintRowCard(layers: TabbedListLayers, slot: Rect): Rect {
  const { ctx, back, graphics } = layers;
  const { scale } = ctx;
  const card = cardRect(slot, scale);
  if (!tileBitmap(back, ctx.bitmaps.button, card, scale)) drawTabButton(graphics, card, scale, false);
  drawPlateOutline(graphics, card, scale);
  return card;
}

/** Destroy the tiled fills (the shell owns clearing `graphics` and the runs). */
export function clearFills(back: Container): void {
  for (const child of back.removeChildren()) child.destroy();
}

/** Paint the window: the shared titled tab-grid part, then this list's row cards and scrollbar. */
export function paintWindow<Id, Item extends TabbedListItem>(
  layers: TabbedListLayers,
  layout: TabbedListLayout<Id, Item>,
  title: string,
): void {
  const { ctx, graphics } = layers;
  const { scale } = ctx;

  const tabs: TitledTab[] = layout.tabs.map((tab) => ({
    rect: tab.rect,
    selected: tab.selected,
    label: tab.stringId === undefined ? tab.label : ctx.uiString('miscwindow', tab.stringId, tab.label),
  }));
  paintTitledTabWindow(layers, layout, tabs, title);

  const { width: rw, height: rh } = ctx.screen();
  for (const row of layout.rows) {
    const card = paintRowCard(layers, row.rect);
    const run = ctx.makeText(row.item.label, 'white', ROW_PX);
    layers.container.addChild(run.container);
    layers.runs.push(run);
    const y = card.y + (card.h - TEXT_CAP_H * scale) / 2;
    run.place(Math.round(card.x + ROW_INSET_X * scale), Math.round(y), scale, rw, rh);
  }
  if (layout.scrollbar !== undefined) {
    drawScrollbar(graphics, layout.scrollbar.track, layout.scrollbar.thumb, scale);
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
  if (row !== undefined) drawHoverHighlight(hover, cardRect(row.rect, scale));
}
