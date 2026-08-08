import type { Container, Graphics } from 'pixi.js';
import type { FontColorName } from '../../../content/font-gfx.js';
import {
  drawBevel,
  drawCloseX,
  drawPlateOutline,
  drawTabButton,
  drawWindowFrame,
  HEADLINE_FILL,
  tileBitmap,
  WOOD_FILL,
} from '../../chrome.js';
import type { Rect } from '../../geometry.js';
import type { TextRun } from '../../text-run.js';
import type { PanelContext } from '../context.js';

/** Drawing and run placement for the titled pop-up window family; the controllers own state, input and
 *  lifecycle, and paint their own content over the shared part. */

/** Text sizes (design px). */
const TITLE_PX = 13;
const TAB_PX = 11;
/** Body text on a row card. */
export const ROW_PX = 11;
/** Approximate cap height (design px) of the body text, for vertically centring a run in a chrome rect. */
export const TEXT_CAP_H = 10;
/** Left inset (design px) of a label inside its button-card. */
export const ROW_INSET_X = 8;
/** Vertical inset (design px) of a card inside its row slot. */
const CARD_INSET_Y = 2;
/** Inset (design px) of the headline strip inside the window frame, so the frame reads around it. */
const HEADLINE_INSET = 2;

/** The layers a family window paints into. */
export interface WindowLayers {
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

/** Build a run and parent it under the window, in draw order after the chrome. */
export function addRun(layers: WindowLayers, text: string, color: FontColorName, px: number): TextRun {
  const run = layers.ctx.makeText(text, color, px);
  layers.container.addChild(run.container);
  layers.runs.push(run);
  return run;
}

/** Place `run` centred in `rect` (the title, tab-label and value-cell rule of the family). */
export function centreRun(layers: WindowLayers, run: TextRun, rect: Rect): void {
  const { scale } = layers.ctx;
  const { width: rw, height: rh } = layers.ctx.screen();
  const x = rect.x + Math.max(0, (rect.w - run.width * scale) / 2);
  run.place(Math.round(x), Math.round(rect.y + (rect.h - TEXT_CAP_H * scale) / 2), scale, rw, rh);
}

/** Place `run` on a card, `inset` design px from its left edge and vertically centred. */
export function placeOnCard(
  layers: WindowLayers,
  run: TextRun,
  card: Rect,
  inset: number = ROW_INSET_X,
): void {
  const { scale } = layers.ctx;
  const { width: rw, height: rh } = layers.ctx.screen();
  const y = card.y + (card.h - TEXT_CAP_H * scale) / 2;
  run.place(Math.round(card.x + inset * scale), Math.round(y), scale, rw, rh);
}

/** Which of the two chrome tiers a plate was drawn in. */
export type PlateTier = 'tiled' | 'flat';

/** Paint a raised button plate over `r`, lit for a pressed or ON state. */
export function paintPlate(layers: WindowLayers, r: Rect, lit: boolean): PlateTier {
  const { ctx, back, graphics } = layers;
  const { scale } = ctx;
  const texture = lit ? ctx.bitmaps.buttonHilite : ctx.bitmaps.button;
  if (!tileBitmap(back, texture, r, scale)) {
    drawTabButton(graphics, r, scale, lit);
    return 'flat';
  }
  drawPlateOutline(graphics, r, scale);
  return 'tiled';
}

/** The card plate inside a row slot, inset vertically so consecutive cards read as separate plates. */
export function rowCardRect(slot: Rect, scale: number): Rect {
  return {
    x: slot.x,
    y: Math.round(slot.y + CARD_INSET_Y * scale),
    w: slot.w,
    h: Math.round(slot.h - 2 * CARD_INSET_Y * scale),
  };
}

/** Paint a list row's card and return the rect its content places against. The gilt edge survives the
 *  flat fallback here, so a run of rows still reads as separate cards. */
export function paintRowCard(layers: WindowLayers, slot: Rect): Rect {
  const card = rowCardRect(slot, layers.ctx.scale);
  if (paintPlate(layers, card, false) === 'flat') {
    drawPlateOutline(layers.graphics, card, layers.ctx.scale);
  }
  return card;
}

/**
 * Paint the shared window part - wood fill, gilt frame, headline band, close box, centred title, and
 * the tab grid with centred labels - queueing and placing each run as it goes.
 */
export function paintTitledTabWindow(
  layers: WindowLayers,
  frame: { readonly window: Rect; readonly titleRect: Rect; readonly closeRect: Rect },
  tabs: readonly TitledTab[],
  title: string,
): void {
  const { ctx, back, graphics } = layers;
  const { scale } = ctx;

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
  centreRun(layers, addRun(layers, title, 'white', TITLE_PX), frame.titleRect);

  for (const tab of tabs) {
    if (paintPlate(layers, tab.rect, tab.selected) === 'tiled' && !tab.selected) {
      drawBevel(graphics, tab.rect, scale, 'pressed'); // recede the inactive tabs
    }
    centreRun(layers, addRun(layers, tab.label, tab.selected ? 'white' : 'dimmed', TAB_PX), tab.rect);
  }
}

/** Destroy the tiled fills (the shell owns clearing `graphics` and the runs). */
export function clearFills(back: Container): void {
  for (const child of back.removeChildren()) child.destroy();
}
