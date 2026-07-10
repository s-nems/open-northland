import { type Rect, contains } from '../geometry.js';

/**
 * The building-menu model — categories, filtering, layout and hit-test (pure, no Pixi/DOM).
 *
 * The original build window ("Zbuduj Okno") groups buildings under five category tabs whose labels come
 * from the ingamegui `miscwindow` string table (ids 2–6): "Wszystko / Praca / Magazyn / Dom / Wojsko".
 * The category a building falls under IS its `logichousetype` `logicmaintype` (1=stock, 2=home, 3=work,
 * 4=training, 5=tower), which the pipeline extracts losslessly as the building `kind` — so the derivation
 * below is DATA-PINNED, not a guess. Only the fold of maintypes 4 (training) + 5 (tower) into the one
 * "Wojsko" tab is our reconstruction (the original's tab→maintype binding isn't decoded); see source basis.
 *
 * The layout is a titled parchment window: a headline band, the five category tabs, then a SCROLLABLE,
 * row-quantized list of the selected category's buildings (a fixed viewport of `maxListRows`, a scrollbar
 * when the category overflows it). It is parameterised by a screen origin + scale (design px, scaled like
 * the tool panel), so the view draws from it and the input layer hit-tests it — both without touching Pixi.
 */

/** A building as the menu needs it: the shared typeId (→ `placeBuilding`), a display label, its class. */
export interface MenuBuildingEntry {
  readonly typeId: number;
  readonly label: string;
  /** The `ir.json` building `kind`: `home | storage | workplace | tower | training`. */
  readonly kind: string;
}

/** The five category tabs, in the original's order. */
export type BuildingCategory = 'all' | 'work' | 'storage' | 'home' | 'military';

export interface BuildingCategoryTab {
  readonly id: BuildingCategory;
  /** Polish label (the pinned fallback, mirroring `miscwindow` string ids 2–6). */
  readonly label: string;
  /** The ingamegui `miscwindow` string id (so the view can prefer the loaded string). */
  readonly stringId: number;
}

export const BUILDING_CATEGORIES: readonly BuildingCategoryTab[] = [
  { id: 'all', label: 'Wszystko', stringId: 2 },
  { id: 'work', label: 'Praca', stringId: 3 },
  { id: 'storage', label: 'Magazyn', stringId: 4 },
  { id: 'home', label: 'Dom', stringId: 5 },
  { id: 'military', label: 'Wojsko', stringId: 6 },
];

/** kind → category. `tower` + `training` both fold into Wojsko (walls/watchtowers + barracks/school). */
const KIND_TO_CATEGORY: Readonly<Record<string, BuildingCategory>> = {
  workplace: 'work',
  storage: 'storage',
  home: 'home',
  tower: 'military',
  training: 'military',
};

/** The category a building `kind` belongs to (defaults to `work` for an unmapped kind). */
export function categoryOfKind(kind: string): BuildingCategory {
  return KIND_TO_CATEGORY[kind] ?? 'work';
}

/** The entries shown under `category` (all of them for `all`), preserving input order. */
export function buildingsInCategory(
  entries: readonly MenuBuildingEntry[],
  category: BuildingCategory,
): readonly MenuBuildingEntry[] {
  if (category === 'all') return entries;
  return entries.filter((e) => categoryOfKind(e.kind) === category);
}

// --- Layout (design px, scaled by uiscale like the tool panel) ------------------------------------

const MENU_PAD = 6;
/** The rust title band across the top of the window. */
const MENU_HEADLINE_H = 18;
// Wide enough for the longest category label ("Wszystko" = 55 native px in font10) plus padding, so the
// tabs never overlap when drawn side by side.
const MENU_TAB_W = 62;
const MENU_TAB_H = 18;
/** Each building sits on its own button-card, so the row slot is taller than a plain text line. */
const MENU_ROW_H = 20;
/** A small gap between the tab row and the list, so the tabs read as a header for it. */
const MENU_LIST_GAP = 3;
const MENU_CLOSE = 13;
/** The scrollbar gutter width — reserved on the right only when the category overflows the viewport. */
const MENU_SCROLLBAR_W = 8;
/** Minimum scrollbar-thumb length so a long list's thumb stays grabbable. */
const MENU_THUMB_MIN = 12;
/** Menu window width holds the five tabs side by side plus padding. */
const MENU_WIDTH = BUILDING_CATEGORIES.length * MENU_TAB_W + 2 * MENU_PAD;

export interface MenuTab {
  readonly category: BuildingCategory;
  readonly label: string;
  readonly stringId: number;
  readonly rect: Rect;
  readonly selected: boolean;
}

export interface MenuRow {
  readonly typeId: number;
  readonly label: string;
  readonly rect: Rect;
  /** The row's index within the FULL filtered list (not the visible slice) — drives the ledger stripe. */
  readonly index: number;
}

/** The scroll state of the list: which rows are visible and how far it can travel. */
export interface MenuScroll {
  /** Index of the first visible row within the filtered list. */
  readonly top: number;
  /** The largest valid `top` (0 when the whole category fits). */
  readonly max: number;
  /** Total rows in the selected category. */
  readonly total: number;
  /** Rows visible at once (the viewport height in rows). */
  readonly visible: number;
}

/** The scrollbar geometry (present only when the list overflows the viewport). */
export interface MenuScrollbar {
  readonly track: Rect;
  readonly thumb: Rect;
}

export interface BuildingMenuLayout {
  readonly scale: number;
  readonly window: Rect;
  /** The headline (title-band) rect. */
  readonly titleRect: Rect;
  readonly closeRect: Rect;
  readonly tabs: readonly MenuTab[];
  /** The clipped list area the visible rows sit in. */
  readonly viewport: Rect;
  /** Only the rows currently visible in the viewport (a slice of the filtered list). */
  readonly rows: readonly MenuRow[];
  readonly scroll: MenuScroll;
  /** Absent when the whole category fits (no scrollbar drawn). */
  readonly scrollbar?: MenuScrollbar;
}

export interface MenuLayoutOptions {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
  readonly selected: BuildingCategory;
  /** First visible row (clamped into range); defaults to 0. */
  readonly scrollTop?: number;
  /** Viewport height in rows; omit for an unbounded list (show every row, no scrollbar). */
  readonly maxListRows?: number;
}

/**
 * Resolve the menu to screen rects: a titled window with the five tabs and a scrollable single-column list
 * of the buildings in the selected category. Purely geometric — text is drawn to fit each rect at render
 * time. The list is row-quantized: it scrolls by whole rows, so no partial row ever straddles the viewport
 * edge and the view needs no Pixi mask.
 */
export function layoutBuildingMenu(
  entries: readonly MenuBuildingEntry[],
  opts: MenuLayoutOptions,
): BuildingMenuLayout {
  const s = Math.max(1, opts.scale);
  const { originX, originY, selected } = opts;
  const px = (v: number): number => Math.round(v * s);
  const shown = buildingsInCategory(entries, selected);
  const total = shown.length;

  const width = px(MENU_WIDTH);
  const headlineH = px(MENU_HEADLINE_H);
  const tabH = px(MENU_TAB_H);
  const rowH = px(MENU_ROW_H);
  const pad = px(MENU_PAD);
  const listGap = px(MENU_LIST_GAP);

  // The visible-row count: capped to `maxListRows` (else the whole category), never below one row.
  const visible = opts.maxListRows === undefined ? total : Math.min(Math.max(1, opts.maxListRows), total);
  const maxScroll = Math.max(0, total - visible);
  const top = Math.max(0, Math.min(opts.scrollTop ?? 0, maxScroll));
  const overflow = total > visible;
  const gutter = overflow ? px(MENU_SCROLLBAR_W) : 0;

  const listTop = originY + headlineH + tabH + listGap;
  const listH = visible * rowH;
  const height = headlineH + tabH + listGap + listH + pad;
  const rowW = width - 2 * pad - gutter;

  const tabs: MenuTab[] = BUILDING_CATEGORIES.map((c, i) => ({
    category: c.id,
    label: c.label,
    stringId: c.stringId,
    selected: c.id === selected,
    rect: { x: originX + pad + i * px(MENU_TAB_W), y: originY + headlineH, w: px(MENU_TAB_W), h: tabH },
  }));

  const rows: MenuRow[] = [];
  for (let i = 0; i < visible; i++) {
    const entry = shown[top + i];
    if (entry === undefined) break;
    rows.push({
      typeId: entry.typeId,
      label: entry.label,
      index: top + i,
      rect: { x: originX + pad, y: listTop + i * rowH, w: rowW, h: rowH },
    });
  }

  const viewport: Rect = { x: originX + pad, y: listTop, w: width - 2 * pad, h: listH };

  const closeSize = px(MENU_CLOSE);
  const layout: BuildingMenuLayout = {
    scale: s,
    window: { x: originX, y: originY, w: width, h: height },
    titleRect: { x: originX + pad, y: originY, w: width - 2 * pad, h: headlineH },
    closeRect: {
      x: originX + width - closeSize - pad,
      y: originY + (headlineH - closeSize) / 2,
      w: closeSize,
      h: closeSize,
    },
    tabs,
    viewport,
    rows,
    scroll: { top, max: maxScroll, total, visible },
  };

  if (!overflow) return layout;

  const trackX = originX + width - pad - gutter;
  const thumbH = Math.max(px(MENU_THUMB_MIN), Math.round((listH * visible) / total));
  const thumbY = maxScroll === 0 ? listTop : listTop + Math.round(((listH - thumbH) * top) / maxScroll);
  return {
    ...layout,
    scrollbar: {
      track: { x: trackX, y: listTop, w: gutter, h: listH },
      thumb: { x: trackX, y: thumbY, w: gutter, h: thumbH },
    },
  };
}

/** What the cursor is over inside an open menu. */
export type MenuHit =
  | { readonly kind: 'tab'; readonly category: BuildingCategory }
  | { readonly kind: 'building'; readonly typeId: number }
  | { readonly kind: 'close' }
  // A page-scroll click on the track above (-1) or below (+1) the thumb.
  | { readonly kind: 'scroll'; readonly dir: -1 | 1 }
  | { readonly kind: 'window' } // over the window chrome/background but not an interactive element
  | null;

/**
 * Resolve a screen point against an open menu (close > tab > scrollbar > building > window background >
 * miss). A click on the scrollbar track pages the list toward the click; a click on the thumb itself is
 * consumed as `window` (no-op) so it never falls through.
 */
export function hitTestBuildingMenu(layout: BuildingMenuLayout, x: number, y: number): MenuHit {
  if (contains(layout.closeRect, x, y)) return { kind: 'close' };
  for (const t of layout.tabs) {
    if (contains(t.rect, x, y)) return { kind: 'tab', category: t.category };
  }
  if (layout.scrollbar !== undefined && contains(layout.scrollbar.track, x, y)) {
    if (contains(layout.scrollbar.thumb, x, y)) return { kind: 'window' };
    return { kind: 'scroll', dir: y < layout.scrollbar.thumb.y ? -1 : 1 };
  }
  for (const r of layout.rows) {
    if (contains(r.rect, x, y)) return { kind: 'building', typeId: r.typeId };
  }
  if (contains(layout.window, x, y)) return { kind: 'window' };
  return null;
}
