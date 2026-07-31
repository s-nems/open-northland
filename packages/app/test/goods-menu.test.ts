import { describe, expect, it } from 'vitest';
import { goodsInCategory, goodsTabbedList, type MenuGoodEntry } from '../src/hud/tool-panel/goods-menu.js';

/**
 * The goods-palette model — the eight category tabs and the category filtering behind them. The tab a
 * good falls under is the shared `goodCategoryTab` (the same mapping the Magazyn panel uses), keyed by
 * the good's string id. The window geometry it feeds is covered by `tabbed-list.test.ts`.
 */

// One good per category by its known stock-tab id: bread→0 (food), water→1 (drink), wood→2 (raw),
// brick→3 (building), tool_iron→4 (tools), shoes→5 (crafted), sword_long→6 (military), coin→7 (misc).
const entries: readonly MenuGoodEntry[] = [
  { goodType: 1, id: 'bread', label: 'Bread' },
  { goodType: 2, id: 'water', label: 'Water' },
  { goodType: 3, id: 'wood', label: 'Wood' },
  { goodType: 4, id: 'brick', label: 'Brick' },
  { goodType: 5, id: 'tool_iron', label: 'Iron Tool' },
  { goodType: 6, id: 'shoes', label: 'Shoes' },
  { goodType: 7, id: 'sword_long', label: 'Long Sword' },
  { goodType: 8, id: 'coin', label: 'Coin' },
];

describe('goods-menu', () => {
  it('filters goods to a category by their stock-tab id', () => {
    expect(goodsInCategory(entries, 2).map((e) => e.id)).toEqual(['wood']); // raw materials
    expect(goodsInCategory(entries, 6).map((e) => e.id)).toEqual(['sword_long']); // military
    expect(goodsInCategory(entries, 7).map((e) => e.id)).toEqual(['coin']); // misc
    // A good with no explicit category falls into the misc tab (7), alongside coin.
    const withUnknown = [...entries, { goodType: 9, id: 'mystery_ware', label: 'Mystery' }];
    expect(goodsInCategory(withUnknown, 7).map((e) => e.id)).toEqual(['coin', 'mystery_ware']);
  });

  it('exposes the eight Magazyn tabs as a two-row grid, opening on Surowce', () => {
    const source = goodsTabbedList(entries);
    expect(source.tabs()).toHaveLength(8);
    expect(source.tabs().map((tab) => tab.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]); // id === stock-tab index
    expect(source.tabColumns).toBe(4); // eight tabs over two grid rows
    expect(source.initialTab).toBe(2);
    expect(source.items(source.initialTab).map((e) => e.id)).toEqual(['wood']);
  });
});
