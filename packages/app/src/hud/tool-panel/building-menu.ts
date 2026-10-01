/**
 * The construction catalogue's model: the entries, their categories and the state the window keeps
 * between openings. A building's category comes from its `kind`, the extracted `logichousetype`
 * `logicmaintype`.
 */

/** Whether the seat may build a type now, read from the sim's unlock status once a tick. */
export type BuildingAvailability =
  | { readonly kind: 'open' }
  /** Not discovered yet: listed after the open entries. */
  | { readonly kind: 'locked' }
  /** The map or the tribe bans it: never listed. */
  | { readonly kind: 'forbidden' };

/** One line of a construction bill, the sim's `GoodsLine` shape. */
export interface CostLine {
  readonly goodType: number;
  readonly amount: number;
}

export const OPEN_AVAILABILITY: BuildingAvailability = { kind: 'open' };

export interface MenuBuildingEntry {
  readonly typeId: number;
  readonly label: string;
  /** The `ir.json` building `kind`: `home | storage | workplace | tower | training`. */
  readonly kind: string;
  /** The from-scratch bill the sim charges, a leveled tier's whole chain summed; empty when unknown. */
  readonly cost: readonly CostLine[];
  /** The trades its worker slots take, which tie a newly opened building to the trade that opened it. */
  readonly trades: readonly number[];
  /** The entry as the seat may build it in `tribe`; absent, always open (a scene without progression). */
  readonly availability?: (tribe: number) => BuildingAvailability;
}

/** The quick row's tools, in the row's order; they lay the half-cell lattice, not a building footprint. */
export const CONSTRUCTION_TOOLS = ['road', 'palisade', 'gate'] as const;
export type ConstructionTool = (typeof CONSTRUCTION_TOOLS)[number];

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

/** The kinds the catalogue lists: the original's selection window skips vehicles and wonders. */
export const CATALOGUE_KINDS: ReadonlySet<string> = new Set(Object.keys(KIND_TO_CATEGORY));

/** Defaults to `work` for an unmapped kind. */
export function categoryOfKind(kind: string): BuildingCategory {
  return KIND_TO_CATEGORY[kind] ?? 'work';
}

export type CatalogueView = 'grid' | 'list';

/** The window's two pages: the catalogue, or the papers (the plans a pick spends), which the quick
 *  row's Papiery button toggles and a back tab leaves. */
export type ConstructionPage = 'catalog' | 'papers';

/** Window state across a HUD-scale remount. Fresh openings show the catalogue, while placement
 *  resumes keep the page. The grid or list view and the nation remain a per-game choice, never
 *  browser storage. */
export interface ConstructionWindowState {
  readonly page: ConstructionPage;
  /** The nation both pages list houses of; null for the seat's own. */
  readonly tribe: number | null;
  readonly category: BuildingCategory;
  readonly view: CatalogueView;
  readonly scrollTop: number;
  readonly picked: number | null;
  readonly suspended: boolean;
}

export const INITIAL_CONSTRUCTION_STATE: ConstructionWindowState = {
  page: 'catalog',
  tribe: null,
  category: 'all',
  view: 'grid',
  scrollTop: 0,
  picked: null,
  suspended: false,
};

/** The construction window's nation switch: the nations offered (the seat's own alone while the sim
 *  names none), the one listed, and whether the switch shows. */
export interface NationChoice {
  readonly nations: readonly number[];
  /** The chosen nation while the seat may still build its houses, else the seat's own. */
  readonly shown: number;
  /** More than one nation: the switch shows. */
  readonly switchable: boolean;
}

export function nationChoice(chosen: number | null, offered: readonly number[], home: number): NationChoice {
  const nations = offered.length === 0 ? [home] : offered;
  const shown = chosen !== null && nations.includes(chosen) ? chosen : (nations[0] ?? home);
  return { nations, shown, switchable: nations.length > 1 };
}
