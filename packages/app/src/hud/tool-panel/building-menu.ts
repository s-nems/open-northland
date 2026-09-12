import { messages } from '../../i18n/index.js';
import type { TabbedListSource } from './tabbed-list/index.js';

/**
 * The building-menu model: categories, filtering, and the tabbed-list source the pop-up draws from.
 * A building's category comes from its `kind`, the extracted `logichousetype` `logicmaintype`.
 */

export interface MenuBuildingEntry {
  readonly disabledReason?: () => string | null;
  readonly typeId: number;
  readonly label: string;
  /** The `ir.json` building `kind`: `home | storage | workplace | tower | training`. */
  readonly kind: string;
}

/** The five category tabs, in the original's order. */
export type BuildingCategory = 'all' | 'work' | 'storage' | 'home' | 'military';

export interface BuildingCategoryTab {
  readonly id: BuildingCategory;
  /** The ingamegui `miscwindow` string id. */
  readonly stringId: number;
}

export const BUILDING_CATEGORIES: readonly BuildingCategoryTab[] = [
  { id: 'all', stringId: 2 },
  { id: 'work', stringId: 3 },
  { id: 'storage', stringId: 4 },
  { id: 'home', stringId: 5 },
  { id: 'military', stringId: 6 },
];

/** Folding `tower` and `training` into one military tab is an approximation. */
const KIND_TO_CATEGORY: Readonly<Record<string, BuildingCategory>> = {
  workplace: 'work',
  storage: 'storage',
  home: 'home',
  tower: 'military',
  training: 'military',
};

/** Defaults to `work` for an unmapped kind. */
export function categoryOfKind(kind: string): BuildingCategory {
  return KIND_TO_CATEGORY[kind] ?? 'work';
}

/** Preserves input order. */
export function buildingsInCategory(
  entries: readonly MenuBuildingEntry[],
  category: BuildingCategory,
): readonly MenuBuildingEntry[] {
  if (category === 'all') return entries;
  return entries.filter((e) => categoryOfKind(e.kind) === category);
}

export function buildingTabbedList(
  entries: readonly MenuBuildingEntry[],
): TabbedListSource<BuildingCategory, MenuBuildingEntry> {
  return {
    // The decoded `miscwindow` id 0 is the original's internal name "Zbuduj Okno", so a clean Polish
    // build-menu title is shown instead.
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
