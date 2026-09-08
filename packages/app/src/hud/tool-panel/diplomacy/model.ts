import type { DiplomacyState } from '@open-northland/sim';
import type { UiString } from '../../../content/gui-gfx.js';
import { messages } from '../../../i18n/index.js';
import { contains, type Rect } from '../../geometry.js';
import { MIN_UI_SCALE } from '../../ui-scale.js';
import {
  CLOSE_BOX,
  HEADLINE_H,
  ROW_H,
  standardWindowWidth,
  TAB_CONTENT_GAP,
  TAB_H,
  WINDOW_FAMILY_PAD,
} from '../window-family/index.js';

/**
 * The diplomacy pop-up model: a titled window with one tab per discovered player over a short stance
 * readout for the selected one. Metrics come from the shared window-family set, so the pop-ups read
 * as one family.
 */

/** Tabs per grid row: two columns, so an authored tribe name has room to stay legible. */
const TAB_COLUMNS = 2;
/** Readout cards under the tabs: identity, then one card per stance direction. */
const BODY_LINES = 3;

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

export interface DiplomacyWindowLayout {
  readonly scale: number;
  readonly window: Rect;
  readonly titleRect: Rect;
  readonly closeRect: Rect;
  readonly tabs: readonly DiplomacyTabRect[];
  /** The readout card slots, top to bottom (one when the row set is empty: the placeholder). */
  readonly bodyLines: readonly Rect[];
}

export interface DiplomacyLayoutOptions {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
  readonly players: readonly number[];
  readonly selected: number | null;
}

/** Resolve the window to screen rects; the height follows the tab-grid row count. */
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

  const height = headlineH + tabsBlockH + px(TAB_CONTENT_GAP) + lineCount * lineH + pad;
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
  };
}

/** What the cursor is over inside the open window. */
export type DiplomacyHit =
  | { readonly kind: 'close' }
  | { readonly kind: 'tab'; readonly player: number }
  | { readonly kind: 'window' } // over the chrome/readout, consumed without an action
  | null;

/** Resolve a screen point against an open window (close > tab > window background > miss). */
export function hitTestDiplomacyWindow(layout: DiplomacyWindowLayout, x: number, y: number): DiplomacyHit {
  if (contains(layout.closeRect, x, y)) return { kind: 'close' };
  for (const t of layout.tabs) {
    if (contains(t.rect, x, y)) return { kind: 'tab', player: t.player };
  }
  if (contains(layout.window, x, y)) return { kind: 'window' };
  return null;
}
