import { STOCK_TAB_LABELS, goodCategoryTab } from '../details-panel/stock-tabs.js';
import { type Rect, contains } from '../geometry.js';

/**
 * The goods-palette model — the eight category tabs, filtering, layout and hit-test (pure, no Pixi/DOM).
 * Twin of {@link import('./building-menu.js')} but for GOODS: it drives the "drop a good on the ground"
 * tool, so a pick hands back a `goodType` the panel drops via the `dropGood` command.
 *
 * The tabs mirror the details-panel Magazyn's eight stock categories (via the shared {@link goodCategoryTab}
 * by string id), so a good sits under the same tab in the drop palette as in a warehouse. That category
 * mapping is a NAMED APPROXIMATION (not in the extracted data — see `details-panel/stock-tabs.ts`).
 *
 * The layout is parameterised by a screen origin + integer scale (design px), so the view draws from it and
 * the input layer hit-tests it, both without touching Pixi. Eight tabs sit in TWO rows of four (keeping the
 * window narrow), then a single-column list of the selected category's goods.
 */

/** A good as the palette needs it: the sim `goodType` (→ `dropGood`), its icon-keying id, and a label. */
export interface MenuGoodEntry {
  readonly goodType: number;
  /** Stable string id (the `ls_goods` icon key + the stock-tab category key). */
  readonly id: string;
  readonly label: string;
}

/** The eight category tabs, in the Magazyn's order (index === the {@link goodCategoryTab} value). */
export interface GoodsCategoryTab {
  readonly index: number;
  readonly label: string;
}

// Derived from the ONE category-label source ({@link STOCK_TAB_LABELS}) so the drop palette's tabs can't
// drift from the Magazyn's — index === the {@link goodCategoryTab} value === array position.
export const GOODS_CATEGORIES: readonly GoodsCategoryTab[] = STOCK_TAB_LABELS.map((label, index) => ({
  index,
  label,
}));

/** The goods shown under `category` (its stock-tab index), preserving input order. */
export function goodsInCategory(
  entries: readonly MenuGoodEntry[],
  category: number,
): readonly MenuGoodEntry[] {
  return entries.filter((e) => goodCategoryTab(e.id) === category);
}

// --- Layout (design px, scaled by uiscale like the tool panel) ------------------------------------

const MENU_PAD = 6;
const MENU_TITLE_H = 16;
/** Fits the longest category label ("Narzędzia") plus padding at font10. */
const MENU_TAB_W = 60;
const MENU_TAB_H = 16;
const MENU_ROW_H = 15;
const MENU_CLOSE = 13;
/** Four tabs per row → two rows for the eight categories, keeping the window narrow. */
const TABS_PER_ROW = 4;
const TAB_ROWS = 2;
/** Window width holds the four tab columns side by side plus padding. */
const MENU_WIDTH = TABS_PER_ROW * MENU_TAB_W + 2 * MENU_PAD;

export interface GoodsMenuTab {
  readonly index: number;
  readonly label: string;
  readonly rect: Rect;
  readonly selected: boolean;
}

export interface GoodsMenuRow {
  readonly goodType: number;
  readonly id: string;
  readonly label: string;
  readonly rect: Rect;
}

export interface GoodsMenuLayout {
  readonly scale: number;
  readonly window: Rect;
  readonly titleRect: Rect;
  readonly closeRect: Rect;
  readonly tabs: readonly GoodsMenuTab[];
  readonly rows: readonly GoodsMenuRow[];
}

export interface GoodsMenuLayoutOptions {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
  readonly selected: number;
}

/**
 * Resolve the palette to screen rects: a titled window with the eight category tabs (two rows of four) and a
 * single-column list of the selected category's goods. Purely geometric — text fits each rect at render time.
 */
export function layoutGoodsMenu(
  entries: readonly MenuGoodEntry[],
  opts: GoodsMenuLayoutOptions,
): GoodsMenuLayout {
  const s = Math.max(1, Math.floor(opts.scale));
  const { originX, originY, selected } = opts;
  const shown = goodsInCategory(entries, selected);

  const width = MENU_WIDTH * s;
  const titleH = MENU_TITLE_H * s;
  const tabH = MENU_TAB_H * s;
  const rowH = MENU_ROW_H * s;
  const pad = MENU_PAD * s;
  const tabsBlockH = TAB_ROWS * tabH;
  const listTop = originY + titleH + tabsBlockH;
  const height = titleH + tabsBlockH + shown.length * rowH + pad;

  const tabs: GoodsMenuTab[] = GOODS_CATEGORIES.map((c, i) => {
    const col = i % TABS_PER_ROW;
    const row = Math.floor(i / TABS_PER_ROW);
    return {
      index: c.index,
      label: c.label,
      selected: c.index === selected,
      rect: {
        x: originX + pad + col * MENU_TAB_W * s,
        y: originY + titleH + row * tabH,
        w: MENU_TAB_W * s,
        h: tabH,
      },
    };
  });

  const rows: GoodsMenuRow[] = shown.map((e, i) => ({
    goodType: e.goodType,
    id: e.id,
    label: e.label,
    rect: { x: originX + pad, y: listTop + i * rowH, w: width - 2 * pad, h: rowH },
  }));

  const closeSize = MENU_CLOSE * s;
  return {
    scale: s,
    window: { x: originX, y: originY, w: width, h: height },
    titleRect: { x: originX + pad, y: originY, w: width - 2 * pad, h: titleH },
    closeRect: {
      x: originX + width - closeSize - pad,
      y: originY + (titleH - closeSize) / 2,
      w: closeSize,
      h: closeSize,
    },
    tabs,
    rows,
  };
}

/** What the cursor is over inside an open palette. */
export type GoodsMenuHit =
  | { readonly kind: 'tab'; readonly category: number }
  | { readonly kind: 'good'; readonly goodType: number }
  | { readonly kind: 'close' }
  | { readonly kind: 'window' } // over the chrome but not an interactive element
  | null;

/** Resolve a screen point against an open palette (close > tab > good > window background > miss). */
export function hitTestGoodsMenu(layout: GoodsMenuLayout, x: number, y: number): GoodsMenuHit {
  if (contains(layout.closeRect, x, y)) return { kind: 'close' };
  for (const t of layout.tabs) {
    if (contains(t.rect, x, y)) return { kind: 'tab', category: t.index };
  }
  for (const r of layout.rows) {
    if (contains(r.rect, x, y)) return { kind: 'good', goodType: r.goodType };
  }
  if (contains(layout.window, x, y)) return { kind: 'window' };
  return null;
}
