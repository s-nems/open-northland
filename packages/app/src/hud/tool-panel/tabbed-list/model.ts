import { contains, type Rect } from '../../geometry.js';

/**
 * The tabbed-list window model - a titled parchment window with a tab grid over a scrollable,
 * row-quantized list, resolved from a screen origin + scale (pure, no Pixi/DOM). The build menu and the
 * goods drop palette are the same window with a different tab source and row projector, so their
 * metrics, scale handling and hit precedence live here once and cannot drift apart.
 */

// --- Metrics (design px, scaled by uiscale like the tool panel) ------------------------------------
// Source basis: APPROXIMATIONS. The original's window metrics are not decoded, so these are the build
// menu's shipped proportions adopted as the shared set; only the label widths they must clear are
// measured (see TAB_COLUMN_W). Pending human visual sign-off against the original.

const PAD = 6;
/** The rust title band across the top of the window. */
const HEADLINE_H = 18;
const TAB_H = 18;
/** Each item sits on its own button-card, so the row slot is taller than a plain text line. */
export const ROW_H = 20;
/** A small gap between the tab grid and the list, so the tabs read as a header for it. */
const LIST_GAP = 3;
const CLOSE = 13;
/** The scrollbar gutter width - reserved on the right only when the list overflows the viewport. */
const SCROLLBAR_W = 8;
/** Minimum scrollbar-thumb length so a long list's thumb stays grabbable. */
const THUMB_MIN = 12;
/** The width seed, not a laid-out size: the column the widest tab label must clear ("Wszystko" = 55
 *  native px in font10) plus padding. Actual tabs are `contentWidth / tabColumns` wide. */
const TAB_COLUMN_W = 62;
/** How many seed columns the window holds - the build menu's five categories, its widest tab grid. */
const WIDTH_COLUMNS = 5;
/** Every tabbed-list window is this wide whatever its own tab count (the grid divides the content
 *  width), so the pop-ups read as one window wherever they open. */
const WINDOW_W = WIDTH_COLUMNS * TAB_COLUMN_W + 2 * PAD;

/** Design-px chrome above the list for a `tabCount`-tab grid `tabColumns` wide - the controller sizes
 *  the viewport from it, so the two can't disagree about how many rows fit the screen. */
export function chromeAboveList(tabCount: number, tabColumns: number): number {
  return HEADLINE_H + Math.ceil(tabCount / tabColumns) * TAB_H + LIST_GAP;
}

// --- Model -----------------------------------------------------------------------------------------

/** A listed item, as the window needs it: it must name itself; the caller keys everything else. */
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
  // Fractional scale, matching every other HUD surface: `buildToolPanelLayout` clamps `?uiscale=` to ≥1
  // and keeps the fraction (the strip art is supersampled to it), so a window that snapped to an integer
  // here would draw at a visibly different size beside the strip. An internal-consistency choice, not an
  // original-behavior finding - the original's own scaling rule is undecoded.
  const s = Math.max(1, opts.scale);
  const { originX, originY, selected, items, tabColumns } = opts;
  const px = (v: number): number => Math.round(v * s);
  const total = items.length;

  const width = px(WINDOW_W);
  const headlineH = px(HEADLINE_H);
  const tabH = px(TAB_H);
  const rowH = px(ROW_H);
  const pad = px(PAD);
  const contentX = originX + pad;
  const contentW = width - 2 * pad;
  const tabRows = Math.ceil(opts.tabs.length / tabColumns);
  const tabsBlockH = tabRows * tabH;

  // The visible-row count: capped to `maxListRows` (else the whole list), never below one row.
  const visible = opts.maxListRows === undefined ? total : Math.min(Math.max(1, opts.maxListRows), total);
  const maxScroll = Math.max(0, total - visible);
  const top = Math.max(0, Math.min(opts.scrollTop ?? 0, maxScroll));
  const overflow = total > visible;
  const gutter = overflow ? px(SCROLLBAR_W) : 0;

  const listTop = originY + headlineH + tabsBlockH + px(LIST_GAP);
  const listH = visible * rowH;
  const height = headlineH + tabsBlockH + px(LIST_GAP) + listH + pad;

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

  const closeSize = px(CLOSE);
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
