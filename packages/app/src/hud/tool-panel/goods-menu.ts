import { messages } from '../../i18n/index.js';
import { goodCategoryTab, stockTabLabels } from '../good-categories.js';
import type { TabbedListSource } from './tabbed-list/index.js';

/**
 * The goods-palette model — the eight category tabs, filtering, and the tabbed-list source the pop-up
 * draws from (pure, no Pixi/DOM). It drives the "drop a good on the ground" tool, so a pick hands back
 * a `goodType` the panel drops via the `dropGood` command; the window itself is the shared `tabbed-list`
 * window the build menu also uses.
 *
 * The tabs mirror the details-panel Magazyn's eight stock categories (via the shared {@link goodCategoryTab}
 * by string id), so a good sits under the same tab in the drop palette as in a warehouse. That category
 * mapping is a NAMED APPROXIMATION (not in the extracted data — see `hud/good-categories.ts`).
 */

/** A good as the palette needs it: the sim `goodType` (→ `dropGood`), its icon-keying id, and a label. */
export interface MenuGoodEntry {
  readonly goodType: number;
  /** Stable string id (the `ls_goods` icon key + the stock-tab category key). */
  readonly id: string;
  readonly label: string;
}

/** Four tabs per grid row → two rows for the eight categories. */
const TABS_PER_ROW = 4;
/** Open on the raw-materials tab (wood/stone/iron/…) — the goods the user reaches for first. */
const DEFAULT_CATEGORY = 2;

/** The goods shown under `category` (its stock-tab index), preserving input order. */
export function goodsInCategory(
  entries: readonly MenuGoodEntry[],
  category: number,
): readonly MenuGoodEntry[] {
  return entries.filter((e) => goodCategoryTab(e.id) === category);
}

/**
 * The drop palette as a tabbed list. The tabs come from the one category-label source
 * ({@link stockTabLabels}) so they can't drift from the Magazyn's — tab id === the
 * {@link goodCategoryTab} value === array position.
 */
export function goodsTabbedList(entries: readonly MenuGoodEntry[]): TabbedListSource<number, MenuGoodEntry> {
  return {
    title: () => messages().hud.resources,
    // The palette is the mission button's tenant until the mission window exists (`button-effects.ts`).
    anchor: 'mission',
    tabColumns: TABS_PER_ROW,
    tabs: () => stockTabLabels().map((label, index) => ({ id: index, label })),
    initialTab: DEFAULT_CATEGORY,
    items: (category) => goodsInCategory(entries, category),
  };
}
