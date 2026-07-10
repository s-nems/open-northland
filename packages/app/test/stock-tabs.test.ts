import { describe, expect, it } from 'vitest';
import { STOCK_TAB_COUNT } from '../src/content/gui-atlas-map.js';
import { STOCK_TAB_LABELS, goodCategoryTab, stockTabRects } from '../src/hud/details-panel/stock-tabs.js';

describe('stock category tabs', () => {
  it('maps known goods to their category tab and unknown goods to the misc tab', () => {
    // Raw materials share tab 2; food shares tab 0; weapons/armor share tab 6.
    expect(goodCategoryTab('wood')).toBe(2);
    expect(goodCategoryTab('stone')).toBe(2);
    expect(goodCategoryTab('mushroom')).toBe(0);
    expect(goodCategoryTab('sword_long')).toBe(6);
    expect(goodCategoryTab('plank')).toBe(3);
    // Every mapped tab index is within the eight-tab strip.
    for (const id of ['wood', 'mushroom', 'plank', 'iron', 'gold', 'coin', 'sword_long']) {
      const tab = goodCategoryTab(id);
      expect(tab).toBeGreaterThanOrEqual(0);
      expect(tab).toBeLessThan(STOCK_TAB_COUNT);
    }
    // An unmapped good falls into the misc/"Inne" tab, never off the strip.
    expect(goodCategoryTab('not_a_real_good')).toBe(STOCK_TAB_COUNT - 1);
    expect(goodCategoryTab(undefined)).toBe(STOCK_TAB_COUNT - 1);
  });

  it('names every tab (a label per plate) so the hover tooltip covers the whole strip', () => {
    expect(STOCK_TAB_LABELS).toHaveLength(STOCK_TAB_COUNT);
    expect(STOCK_TAB_LABELS.every((l) => l.length > 0)).toBe(true);
  });

  it('lays the tab plates left-to-right across the strip without overlap', () => {
    const strip = { x: 10, y: 100, w: 320, h: 18 };
    const rects = stockTabRects(strip, 1);
    expect(rects).toHaveLength(STOCK_TAB_COUNT);
    // First plate starts at the strip's left; each subsequent plate starts to the right of the prior one.
    expect(rects[0]?.x).toBe(strip.x);
    for (let i = 1; i < rects.length; i++) {
      const prev = rects[i - 1];
      const cur = rects[i];
      if (prev === undefined || cur === undefined) throw new Error('missing tab rect');
      expect(cur.x).toBeGreaterThanOrEqual(prev.x + prev.w);
    }
    // The last plate stays within the strip.
    const last = rects[rects.length - 1];
    if (last === undefined) throw new Error('missing last tab rect');
    expect(last.x + last.w).toBeLessThanOrEqual(strip.x + strip.w + 1);
  });
});
