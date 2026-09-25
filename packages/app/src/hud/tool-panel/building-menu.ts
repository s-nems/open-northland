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
  /** Absent, the entry is always open (a scene without progression). */
  readonly availability?: () => BuildingAvailability;
  /** A wall-family row shown beside military buildings but placed on the half-cell lattice. */
  readonly placement?: {
    readonly kind: 'palisade';
    readonly gfxIndex: number;
    readonly mode: 'wall' | 'gate';
  };
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
 *  resumes keep the page. The grid or list view remains a per-game choice, never browser storage. */
export interface ConstructionWindowState {
  readonly page: ConstructionPage;
  readonly category: BuildingCategory;
  readonly view: CatalogueView;
  readonly scrollTop: number;
  readonly picked: number | null;
  readonly suspended: boolean;
}

export const INITIAL_CONSTRUCTION_STATE: ConstructionWindowState = {
  page: 'catalog',
  category: 'all',
  view: 'grid',
  scrollTop: 0,
  picked: null,
  suspended: false,
};
