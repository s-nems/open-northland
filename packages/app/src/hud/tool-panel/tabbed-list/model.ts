import { contains, type Rect } from '../../geometry.js';
import { MIN_UI_SCALE } from '../../ui-scale.js';

/**
 * The tabbed-list window model: a titled parchment window with a tab grid over a scrollable,
 * row-quantized list, resolved from a screen origin and scale.
 */

// Metrics in design px, scaled by uiscale, exported as the one metric set of the titled tab-grid
// window family (the tabbed lists and the diplomacy window). Approximation: the original's window
// metrics are not decoded, so these are the build menu's proportions adopted as the shared set, and
// only the label widths they must clear are measured.

export const WINDOW_FAMILY_PAD = 6;
/** The rust title band across the top of the window. */
export const HEADLINE_H = 18;
export const TAB_H = 18;
/** Each item sits on its own button-card, so the row slot is taller than a plain text line. */
export const ROW_H = 20;
/** A small gap between the tab grid and whatever content sits under it. */
export const TAB_CONTENT_GAP = 3;
export const CLOSE_BOX = 13;
/** The scrollbar gutter width - reserved on the right only when the list overflows the viewport. */
const SCROLLBAR_W = 8;
/** Minimum scrollbar-thumb length so a long list's thumb stays grabbable. */
const THUMB_MIN = 12;
/** The width seed, not a laid-out size: the column the widest tab label must clear, measured as 55 px
 *  for "Wszystko" in the original's font10 face, plus padding. Actual tabs are `contentWidth /
 *  tabColumns` wide. */
const TAB_COLUMN_W = 62;
/** How many seed columns the window holds - the build menu's five categories, its widest tab grid. */
const WIDTH_COLUMNS = 5;
/** Every tabbed-list window is this wide whatever its own tab count (the grid divides the content
 *  width), so the pop-ups read as one window wherever they open. */
const WINDOW_W = WIDTH_COLUMNS * TAB_COLUMN_W + 2 * WINDOW_FAMILY_PAD;

/** Design-px chrome above the list for a `tabCount`-tab grid `tabColumns` wide. */
export function chromeAboveList(tabCount: number, tabColumns: number): number {
  return HEADLINE_H + Math.ceil(tabCount / tabColumns) * TAB_H + TAB_CONTENT_GAP;
}

/** The screen-px width of every tabbed-list window, fixed per scale so a controller knows its x-span
 *  before it has a layout. */
export function tabbedListWindowWidth(scale: number): number {
  return Math.round(WINDOW_W * Math.max(MIN_UI_SCALE, scale));
}

/** A listed item: the window needs only its label. */
export interface TabbedListItem {
  readonly label: string;
}

export interface TabbedListTab<Id> {
  readonly id: Id;
  readonly label: string;
  /** The ingamegui `miscwindow` string id, when the original names this tab (the view prefers it). */
  readonly stringId?: number;
}

export interface TabbedListTabRect<Id> extends TabbedListTab<Id> {
  readonly rect: Rect;
  readonly selected: boolean;
}

export interface TabbedListRow<Item> {
  readonly item: Item;
  readonly rect: Rect;
}

export interface TabbedListScroll {
  /** Index of the first visible row within the selected tab's items. */
  readonly top: number;
  /** The largest valid `top` (0 when the whole tab fits). */
  readonly max: number;
  readonly total: number;
  /** Rows visible at once (the viewport height in rows). */
  readonly visible: number;
}

export interface TabbedListScrollbar {
  readonly track: Rect;
  readonly thumb: Rect;
}

export interface TabbedListLayout<Id, Item> {
  readonly scale: number;
  readonly window: Rect;
  /** The headline (title-band) rect. */
  readonly titleRect: Rect;
  readonly closeRect: Rect;
  readonly tabs: readonly TabbedListTabRect<Id>[];
  readonly viewport: Rect;
  /** Only the rows currently visible in the viewport (a slice of the selected tab's items). */
  readonly rows: readonly TabbedListRow<Item>[];
  readonly scroll: TabbedListScroll;
  /** Absent when the whole tab fits (no scrollbar drawn). */
  readonly scrollbar?: TabbedListScrollbar;
}

export interface TabbedListLayoutOptions<Id, Item> {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
  readonly tabs: readonly TabbedListTab<Id>[];
  /** Tabs per grid row; the rest wrap onto further rows. */
  readonly tabColumns: number;
  readonly selected: Id;
  /** The selected tab's items, in display order. */
  readonly items: readonly Item[];
  /** First visible row (clamped into range); defaults to 0. */
  readonly scrollTop?: number;
  /** Viewport height in rows; omit for an unbounded list (show every row, no scrollbar). */
  readonly maxListRows?: number;
}

/**
 * Resolve the window to screen rects. The list is row-quantized: it scrolls by whole rows, so no partial
 * row ever straddles the viewport edge and the view needs no Pixi mask.
 */
export function layoutTabbedList<Id, Item>(
  opts: TabbedListLayoutOptions<Id, Item>,
): TabbedListLayout<Id, Item> {
  // Kept fractional like every other HUD surface; snapping to an integer here would draw the window at a
  // visibly different size beside the strip. The original's own scaling rule is undecoded.
  const s = Math.max(MIN_UI_SCALE, opts.scale);
  const { originX, originY, selected, items, tabColumns } = opts;
  const px = (v: number): number => Math.round(v * s);
  const total = items.length;

  const width = tabbedListWindowWidth(opts.scale);
  const headlineH = px(HEADLINE_H);
  const tabH = px(TAB_H);
  const rowH = px(ROW_H);
  const pad = px(WINDOW_FAMILY_PAD);
  const contentX = originX + pad;
  const contentW = width - 2 * pad;
  const tabRows = Math.ceil(opts.tabs.length / tabColumns);
  const tabsBlockH = tabRows * tabH;

  const visible = opts.maxListRows === undefined ? total : Math.min(Math.max(1, opts.maxListRows), total);
  const maxScroll = Math.max(0, total - visible);
  const top = Math.max(0, Math.min(opts.scrollTop ?? 0, maxScroll));
  const overflow = total > visible;
  const gutter = overflow ? px(SCROLLBAR_W) : 0;

  const listTop = originY + headlineH + tabsBlockH + px(TAB_CONTENT_GAP);
  const listH = visible * rowH;
  const height = headlineH + tabsBlockH + px(TAB_CONTENT_GAP) + listH + pad;

  // Column edges, so the tabs tile the content width exactly however it divides.
  const tabEdge = (column: number): number => contentX + Math.round((contentW * column) / tabColumns);
  const tabs: TabbedListTabRect<Id>[] = opts.tabs.map((tab, i) => {
    const column = i % tabColumns;
    const left = tabEdge(column);
    return {
      ...tab,
      selected: tab.id === selected,
      rect: {
        x: left,
        y: originY + headlineH + Math.floor(i / tabColumns) * tabH,
        w: tabEdge(column + 1) - left,
        h: tabH,
      },
    };
  });

  const rows: TabbedListRow<Item>[] = [];
  for (let i = 0; i < visible; i++) {
    const item = items[top + i];
    if (item === undefined) break;
    rows.push({ item, rect: { x: contentX, y: listTop + i * rowH, w: contentW - gutter, h: rowH } });
  }

  const closeSize = px(CLOSE_BOX);
  const layout: TabbedListLayout<Id, Item> = {
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
    viewport: { x: contentX, y: listTop, w: contentW, h: listH },
    rows,
    scroll: { top, max: maxScroll, total, visible },
  };

  if (!overflow) return layout;

  const trackX = originX + width - pad - gutter;
  const thumbH = Math.max(px(THUMB_MIN), Math.round((listH * visible) / total));
  const thumbY = maxScroll === 0 ? listTop : listTop + Math.round(((listH - thumbH) * top) / maxScroll);
  return {
    ...layout,
    scrollbar: {
      track: { x: trackX, y: listTop, w: gutter, h: listH },
      thumb: { x: trackX, y: thumbY, w: gutter, h: thumbH },
    },
  };
}

/** What the cursor is over inside an open window. */
export type TabbedListHit<Id, Item> =
  | { readonly kind: 'tab'; readonly tab: Id }
  | { readonly kind: 'row'; readonly item: Item }
  | { readonly kind: 'close' }
  // A page-scroll click on the track above (-1) or below (+1) the thumb.
  | { readonly kind: 'scroll'; readonly dir: -1 | 1 }
  | { readonly kind: 'window' } // over the window chrome/background but not an interactive element
  | null;

/**
 * Resolve a screen point against an open window (close > tab > scrollbar > row > window background >
 * miss). A click on the scrollbar track pages the list toward the click; a click on the thumb itself is
 * consumed as `window` (no-op) so it never falls through.
 */
export function hitTestTabbedList<Id, Item>(
  layout: TabbedListLayout<Id, Item>,
  x: number,
  y: number,
): TabbedListHit<Id, Item> {
  if (contains(layout.closeRect, x, y)) return { kind: 'close' };
  for (const t of layout.tabs) {
    if (contains(t.rect, x, y)) return { kind: 'tab', tab: t.id };
  }
  if (layout.scrollbar !== undefined && contains(layout.scrollbar.track, x, y)) {
    if (contains(layout.scrollbar.thumb, x, y)) return { kind: 'window' };
    return { kind: 'scroll', dir: y < layout.scrollbar.thumb.y ? -1 : 1 };
  }
  for (const r of layout.rows) {
    if (contains(r.rect, x, y)) return { kind: 'row', item: r.item };
  }
  if (contains(layout.window, x, y)) return { kind: 'window' };
  return null;
}
