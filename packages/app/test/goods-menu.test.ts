import { describe, expect, it } from 'vitest';
import {
  GOODS_CATEGORIES,
  type MenuGoodEntry,
  goodsInCategory,
  hitTestGoodsMenu,
  layoutGoodsMenu,
} from '../src/hud/tool-panel/goods-menu.js';

/**
 * The goods-palette pure model — the eight category tabs, category filtering, layout, and hit-test. The tab
 * a good falls under is the shared `goodCategoryTab` (the same mapping the Magazyn panel uses), keyed by the
 * good's string id.
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
  it('has the eight Magazyn category tabs, indexed 0..7', () => {
    expect(GOODS_CATEGORIES).toHaveLength(8);
    expect(GOODS_CATEGORIES.map((c) => c.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('filters goods to a category by their stock-tab id', () => {
    expect(goodsInCategory(entries, 2).map((e) => e.id)).toEqual(['wood']); // raw materials
    expect(goodsInCategory(entries, 6).map((e) => e.id)).toEqual(['sword_long']); // military
    expect(goodsInCategory(entries, 7).map((e) => e.id)).toEqual(['coin']); // misc
    // A good with no explicit category falls into the misc tab (7), alongside coin.
    const withUnknown = [...entries, { goodType: 9, id: 'mystery_ware', label: 'Mystery' }];
    expect(goodsInCategory(withUnknown, 7).map((e) => e.id)).toEqual(['coin', 'mystery_ware']);
  });

  it('lays out and hit-tests the palette (tab, good, close, window, miss)', () => {
    const layout = layoutGoodsMenu(entries, { originX: 100, originY: 50, scale: 2, selected: 2 });

    // Eight tabs (two rows of four); the raw-materials tab is selected and lists just wood.
    expect(layout.tabs).toHaveLength(8);
    expect(layout.rows.map((r) => r.id)).toEqual(['wood']);

    const rawTab = layout.tabs[2];
    if (rawTab === undefined) throw new Error('missing raw-materials tab');
    expect(hitTestGoodsMenu(layout, rawTab.rect.x + 1, rawTab.rect.y + 1)).toEqual({
      kind: 'tab',
      category: 2,
    });

    const woodRow = layout.rows[0];
    if (woodRow === undefined) throw new Error('missing wood row');
    expect(hitTestGoodsMenu(layout, woodRow.rect.x + 1, woodRow.rect.y + 1)).toEqual({
      kind: 'good',
      goodType: 3,
    });

    expect(hitTestGoodsMenu(layout, layout.closeRect.x + 1, layout.closeRect.y + 1)).toEqual({
      kind: 'close',
    });
    expect(hitTestGoodsMenu(layout, layout.window.x + 1, layout.window.y + layout.window.h - 2)).toEqual({
      kind: 'window',
    });
    expect(hitTestGoodsMenu(layout, 5000, 5000)).toBeNull();
  });

  it('lays the eight tabs in two rows of four', () => {
    const layout = layoutGoodsMenu(entries, { originX: 0, originY: 0, scale: 1, selected: 0 });
    const row0 = layout.tabs.slice(0, 4).map((t) => t.rect.y);
    const row1 = layout.tabs.slice(4, 8).map((t) => t.rect.y);
    expect(new Set(row0).size).toBe(1); // first four share a y
    expect(new Set(row1).size).toBe(1); // next four share a lower y
    expect(row1[0]).toBeGreaterThan(row0[0] ?? 0);
  });
});
