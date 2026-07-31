import { messages } from '../../i18n/index.js';
import type { TabbedListSource } from './tabbed-list/index.js';

/**
 * The building-menu model — categories, filtering, and the tabbed-list source the pop-up draws from
 * (pure, no Pixi/DOM). The window itself is the shared `tabbed-list` window.
 *
 * The original build window ("Zbuduj Okno") groups buildings under five category tabs whose labels come
 * from the ingamegui `miscwindow` string table (ids 2–6): "Wszystko / Praca / Magazyn / Dom / Wojsko".
 * The category a building falls under is its `logichousetype` `logicmaintype` (1=stock, 2=home, 3=work,
 * 4=training, 5=tower), which the pipeline extracts losslessly as the building `kind` — so the derivation
 * below is data-pinned, not a guess. Only the fold of maintypes 4 (training) + 5 (tower) into the one
 * "Wojsko" tab is our reconstruction (the original's tab→maintype binding isn't decoded); see source basis.
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
  /** The ingamegui `miscwindow` string id (so the view can prefer the loaded string). */
  readonly stringId: number;
}

export const BUILDING_CATEGORIES: readonly BuildingCategoryTab[] = [
  { id: 'all', stringId: 2 },
  { id: 'work', stringId: 3 },
  { id: 'storage', stringId: 4 },
  { id: 'home', stringId: 5 },
  { id: 'military', stringId: 6 },
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

/** The build menu as a tabbed list: the five categories over the buildings each one holds. */
export function buildingTabbedList(
  entries: readonly MenuBuildingEntry[],
): TabbedListSource<BuildingCategory, MenuBuildingEntry> {
  return {
    // The decoded `miscwindow` id 0 is the original's clunky internal name "Zbuduj Okno", so a clean
    // Polish build-menu title is shown instead.
    title: () => messages().hud.build,
    anchor: 'buildings',
    tabColumns: BUILDING_CATEGORIES.length,
    tabs: () =>
      BUILDING_CATEGORIES.map((c) => ({
        id: c.id,
        label: messages().hud.categories[c.id],
        stringId: c.stringId,
      })),
    initialTab: 'all',
    items: (category) => buildingsInCategory(entries, category),
  };
}
