import { messages } from '../../i18n/index.js';
import { goodCategoryTab, stockTabLabels } from '../good-categories.js';
import type { TabbedListSource } from './tabbed-list/index.js';

/**
 * The goods-palette model: the eight category tabs, filtering, and the tabbed-list source the pop-up
 * draws from. Which tab a good falls under is an approximation shared with the details-panel warehouse
 * through `hud/good-categories.ts`.
 */

export interface MenuGoodEntry {
  readonly goodType: number;
  /** Stable string id (the `ls_goods` icon key + the stock-tab category key). */
  readonly id: string;
  readonly label: string;
}

const TABS_PER_ROW = 4;
/** Index 2 is the raw-materials tab (wood/stone/iron). */
const DEFAULT_CATEGORY = 2;

/** `category` is a stock-tab index; input order is preserved. */
export function goodsInCategory(
  entries: readonly MenuGoodEntry[],
  category: number,
): readonly MenuGoodEntry[] {
  return entries.filter((e) => goodCategoryTab(e.id) === category);
}

/** A tab id is both the `goodCategoryTab` value and the label's position in `stockTabLabels`. */
export function goodsTabbedList(entries: readonly MenuGoodEntry[]): TabbedListSource<number, MenuGoodEntry> {
  return {
    title: () => messages().hud.resources,
    anchor: 'mission',
    tabColumns: TABS_PER_ROW,
    tabs: () => stockTabLabels().map((label, index) => ({ id: index, label })),
    initialTab: DEFAULT_CATEGORY,
    items: (category) => goodsInCategory(entries, category),
  };
}
