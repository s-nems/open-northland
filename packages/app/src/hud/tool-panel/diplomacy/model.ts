import type { DiplomacyState } from '@open-northland/sim';
import type { UiString } from '../../../content/gui-gfx.js';
import { messages } from '../../../i18n/index.js';
import { contains, type Rect } from '../../geometry.js';
import { MIN_UI_SCALE } from '../../ui-scale.js';
import {
  CLOSE_BOX,
  HEADLINE_H,
  ROW_H,
  ROW_INSET_X,
  standardWindowWidth,
  TAB_CONTENT_GAP,
  TAB_H,
  WINDOW_FAMILY_PAD,
} from '../window-family/index.js';

/**
 * The diplomacy pop-up model: a titled window with one tab per discovered player over a short stance
 * readout for the selected one, and under it the tributes the viewer owes that player, each a card
 * with a pay button, the place the original lists them (reading). Metrics come from the shared
 * window-family set, so the pop-ups read as one family.
 */

/** Tabs per grid row: two columns, so an authored tribe name has room to stay legible. */
const TAB_COLUMNS = 2;
/** Readout cards under the tabs: identity, then one card per stance direction. */
const BODY_LINES = 3;
/** A tribute card stacks its wrapped description over one line per demand (design px per line),
 *  inside a vertical pad. */
const TRIBUTE_LINE_H = 12;
const TRIBUTE_CARD_PAD_Y = 4;
/** The pay button inside a tribute card (design px): its width and its inset from the card's edges. */
const PAY_BUTTON_W = 48;
const PAY_BUTTON_INSET = 5;

/** The width (design px) a tribute card's text wraps to: the card minus the label inset and the pay
 *  button with its insets. */
export function tributeTextWidth(scale: number): number {
  const s = Math.max(MIN_UI_SCALE, scale);
  const cardW = standardWindowWidth(scale) / s - 2 * WINDOW_FAMILY_PAD;
  return Math.floor(cardW - ROW_INSET_X - PAY_BUTTON_W - 2 * PAY_BUTTON_INSET);
}

/** One tribute the viewer owes the row's player, as the window lists it. */
export interface TributePanelRow {
  readonly slot: number;
  /** The map's own description; absent renders the numbered fallback. */
  readonly text?: string;
  readonly demands: readonly {
    readonly label: string;
    readonly amount: number;
    /** What the viewer's stores hold of the good between them. */
    readonly onHand: number;
  }[];
  /** The viewer may pay now: its stores hold every demand between them, and the seat is its own. */
  readonly payable: boolean;
}

/** The decoded `misclogic` rows naming each stance. */
const STANCE_STRING_ID: Readonly<Record<DiplomacyState, number>> = {
  friend: 200,
  neutral: 201,
  enemy: 202,
};

/** A stance in the player's language. */
export function diplomacyStanceText(uiString: UiString, state: DiplomacyState): string {
  return uiString('misclogic', STANCE_STRING_ID[state], messages().hud.diplomacyStances[state]);
}

/** One discovered player as the window lists it. */
export interface DiplomacyPanelRow {
  readonly player: number;
  /** Authored roster name; absent renders the numbered fallback. */
  readonly name?: string;
  /** 0xRRGGBB team swatch. */
  readonly colour: number;
  /** The stance this player holds toward the viewer. */
  readonly towardYou: DiplomacyState;
  /** The stance the viewer holds toward this player. */
  readonly yourStance: DiplomacyState;
  /** The open tributes the viewer owes this player, ascending by slot. */
  readonly tributes: readonly TributePanelRow[];
}

/** The selected tab resolved against the live row set: a selection whose player vanished (or was never
 *  made) falls back to the first row, and an empty set to null. */
export function resolveSelectedPlayer(
  rows: readonly DiplomacyPanelRow[],
  selected: number | null,
): number | null {
  if (selected !== null && rows.some((r) => r.player === selected)) return selected;
  return rows[0]?.player ?? null;
}

export interface DiplomacyTabRect {
  readonly player: number;
  readonly rect: Rect;
  readonly selected: boolean;
}

export interface DiplomacyTributeRect {
  readonly slot: number;
  readonly payable: boolean;
  /** The card's row slot; the pay button sits inside it at the right. */
  readonly card: Rect;
  readonly pay: Rect;
  /** Where the description's top-left lands. */
  readonly text: { readonly x: number; readonly y: number };
  /** The single lines under the description, top to bottom. */
  readonly lines: readonly { readonly x: number; readonly y: number }[];
}

export interface DiplomacyWindowLayout {
  readonly scale: number;
  readonly window: Rect;
  readonly titleRect: Rect;
  readonly closeRect: Rect;
  readonly tabs: readonly DiplomacyTabRect[];
  /** The readout card slots, top to bottom (one when the row set is empty: the placeholder). */
  readonly bodyLines: readonly Rect[];
  /** The selected player's tribute cards under the readout, in the order they were given. */
  readonly tributes: readonly DiplomacyTributeRect[];
}

/** What the layout needs of a tribute: the card grows with the wrapped description and one line per
 *  entry under it. */
export interface TributeCardSpec {
  readonly slot: number;
  readonly payable: boolean;
  /** The wrapped description's height (design px). */
  readonly descriptionH: number;
  /** The single lines under the description. */
  readonly lines: number;
}

export interface DiplomacyLayoutOptions {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
  readonly players: readonly number[];
  readonly selected: number | null;
  /** The selected player's tributes, in listing order. */
  readonly tributes: readonly TributeCardSpec[];
}

/** Resolve the window to screen rects; the height follows the tab-grid row count and the tributes. */
export function layoutDiplomacyWindow(opts: DiplomacyLayoutOptions): DiplomacyWindowLayout {
  const s = Math.max(MIN_UI_SCALE, opts.scale);
  const { originX, originY, players } = opts;
  const px = (v: number): number => Math.round(v * s);

  const width = standardWindowWidth(opts.scale);
  const headlineH = px(HEADLINE_H);
  const tabH = px(TAB_H);
  const lineH = px(ROW_H);
  const pad = px(WINDOW_FAMILY_PAD);
  const contentX = originX + pad;
  const contentW = width - 2 * pad;
  const tabRows = Math.ceil(players.length / TAB_COLUMNS);
  const tabsBlockH = tabRows * tabH;
  const lineCount = players.length === 0 ? 1 : BODY_LINES;

  const tabEdge = (column: number): number => contentX + Math.round((contentW * column) / TAB_COLUMNS);
  const tabs: DiplomacyTabRect[] = players.map((player, i) => {
    const column = i % TAB_COLUMNS;
    const left = tabEdge(column);
    return {
      player,
      selected: player === opts.selected,
      rect: {
        x: left,
        y: originY + headlineH + Math.floor(i / TAB_COLUMNS) * tabH,
        w: tabEdge(column + 1) - left,
        h: tabH,
      },
    };
  });

  const bodyTop = originY + headlineH + tabsBlockH + px(TAB_CONTENT_GAP);
  const bodyLines: Rect[] = [];
  for (let i = 0; i < lineCount; i++) {
    bodyLines.push({ x: contentX, y: bodyTop + i * lineH, w: contentW, h: lineH });
  }

  const payInset = px(PAY_BUTTON_INSET);
  const payW = px(PAY_BUTTON_W);
  const textX = contentX + px(ROW_INSET_X);
  let nextCardY = bodyTop + lineCount * lineH;
  const tributes: DiplomacyTributeRect[] = opts.tributes.map((tribute) => {
    const linesTop = TRIBUTE_CARD_PAD_Y + tribute.descriptionH;
    const cardH = px(linesTop + tribute.lines * TRIBUTE_LINE_H + TRIBUTE_CARD_PAD_Y);
    const card: Rect = { x: contentX, y: nextCardY, w: contentW, h: cardH };
    nextCardY += cardH;
    const lines: { x: number; y: number }[] = [];
    for (let i = 0; i < tribute.lines; i++) {
      lines.push({ x: textX, y: card.y + px(linesTop + i * TRIBUTE_LINE_H) });
    }
    return {
      slot: tribute.slot,
      payable: tribute.payable,
      card,
      pay: {
        x: card.x + card.w - payInset - payW,
        y: card.y + payInset,
        w: payW,
        h: card.h - 2 * payInset,
      },
      text: { x: textX, y: card.y + px(TRIBUTE_CARD_PAD_Y) },
      lines,
    };
  });

  const height = nextCardY - originY + pad;
  const closeSize = px(CLOSE_BOX);
  return {
    scale: s,
    window: { x: originX, y: originY, w: width, h: height },
    titleRect: { x: contentX, y: originY, w: contentW, h: headlineH },
    closeRect: {
      x: originX + width - closeSize - pad,
      y: originY + (headlineH - closeSize) / 2,
      w: closeSize,
      h: closeSize,
    },
    tabs,
    bodyLines,
    tributes,
  };
}

/** What the cursor is over inside the open window. */
export type DiplomacyHit =
  | { readonly kind: 'close' }
  | { readonly kind: 'tab'; readonly player: number }
  | { readonly kind: 'pay'; readonly slot: number }
  | { readonly kind: 'window' } // over the chrome, the readout or a dead button, consumed without an action
  | null;

/** Resolve a screen point against an open window (close > tab > live pay button > window background >
 *  miss). A pay button that is not live is window background. */
export function hitTestDiplomacyWindow(layout: DiplomacyWindowLayout, x: number, y: number): DiplomacyHit {
  if (contains(layout.closeRect, x, y)) return { kind: 'close' };
  for (const t of layout.tabs) {
    if (contains(t.rect, x, y)) return { kind: 'tab', player: t.player };
  }
  for (const t of layout.tributes) {
    if (t.payable && contains(t.pay, x, y)) return { kind: 'pay', slot: t.slot };
  }
  if (contains(layout.window, x, y)) return { kind: 'window' };
  return null;
}
