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
 * The layout is parameterised by a screen origin + integer scale (design px, scaled like the tool panel),
 * so the view draws from it and the input layer hit-tests it — both without touching Pixi.
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
const MENU_TITLE_H = 16;
// Wide enough for the longest category label ("Wszystko" = 55 native px in font10) plus padding, so the
// tabs never overlap when drawn side by side.
const MENU_TAB_W = 62;
const MENU_TAB_H = 16;
const MENU_ROW_H = 15;
const MENU_CLOSE = 13;
/** Menu window width holds the five tabs side by side plus padding. */
const MENU_WIDTH = BUILDING_CATEGORIES.length * MENU_TAB_W + 2 * MENU_PAD;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

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
}

export interface BuildingMenuLayout {
  readonly scale: number;
  readonly window: Rect;
  readonly titleRect: Rect;
  readonly closeRect: Rect;
  readonly tabs: readonly MenuTab[];
  readonly rows: readonly MenuRow[];
}

export interface MenuLayoutOptions {
  readonly originX: number;
  readonly originY: number;
  readonly scale: number;
  readonly selected: BuildingCategory;
}

/**
 * Resolve the menu to screen rects: a titled window with the five tabs and a single-column list of the
 * buildings in the selected category. Purely geometric — text is drawn to fit each rect at render time.
 */
export function layoutBuildingMenu(
  entries: readonly MenuBuildingEntry[],
  opts: MenuLayoutOptions,
): BuildingMenuLayout {
  const s = Math.max(1, Math.floor(opts.scale));
  const { originX, originY, selected } = opts;
  const shown = buildingsInCategory(entries, selected);

  const width = MENU_WIDTH * s;
  const titleH = MENU_TITLE_H * s;
  const tabH = MENU_TAB_H * s;
  const rowH = MENU_ROW_H * s;
  const pad = MENU_PAD * s;
  const listTop = originY + titleH + tabH;
  const height = titleH + tabH + shown.length * rowH + pad;

  const tabs: MenuTab[] = BUILDING_CATEGORIES.map((c, i) => ({
    category: c.id,
    label: c.label,
    stringId: c.stringId,
    selected: c.id === selected,
    rect: { x: originX + pad + i * MENU_TAB_W * s, y: originY + titleH, w: MENU_TAB_W * s, h: tabH },
  }));

  const rows: MenuRow[] = shown.map((e, i) => ({
    typeId: e.typeId,
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

/** What the cursor is over inside an open menu. */
export type MenuHit =
  | { readonly kind: 'tab'; readonly category: BuildingCategory }
  | { readonly kind: 'building'; readonly typeId: number }
  | { readonly kind: 'close' }
  | { readonly kind: 'window' } // over the window chrome/background but not an interactive element
  | null;

function within(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

/** Resolve a screen point against an open menu (close > tab > building > window background > miss). */
export function hitTestBuildingMenu(layout: BuildingMenuLayout, x: number, y: number): MenuHit {
  if (within(layout.closeRect, x, y)) return { kind: 'close' };
  for (const t of layout.tabs) {
    if (within(t.rect, x, y)) return { kind: 'tab', category: t.category };
  }
  for (const r of layout.rows) {
    if (within(r.rect, x, y)) return { kind: 'building', typeId: r.typeId };
  }
  if (within(layout.window, x, y)) return { kind: 'window' };
  return null;
}
