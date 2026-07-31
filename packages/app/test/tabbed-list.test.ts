import { describe, expect, it } from 'vitest';
import { buildingTabbedList, type MenuBuildingEntry } from '../src/hud/tool-panel/building-menu.js';
import { goodsTabbedList, type MenuGoodEntry } from '../src/hud/tool-panel/goods-menu.js';
import { DEFAULT_UI_SCALE } from '../src/hud/tool-panel/layout.js';
import {
  hitTestTabbedList,
  layoutTabbedList,
  type TabbedListSource,
  type TabbedListTab,
} from '../src/hud/tool-panel/tabbed-list/index.js';

/**
 * The shared tabbed-list window model — the one layout + hit-test the build menu and the goods drop
 * palette are both built from. The last block is the regression that motivated sharing it: the two
 * windows must resolve `?uiscale=` identically, so the strip reads as one scale.
 */

interface Item {
  readonly label: string;
}

const TABS: readonly TabbedListTab<string>[] = [
  { id: 'a', label: 'A', stringId: 2 },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
  { id: 'd', label: 'D' },
];

const ITEMS: readonly Item[] = Array.from({ length: 10 }, (_, i) => ({ label: `I${i}` }));

const base = {
  originX: 100,
  originY: 50,
  scale: 2,
  tabs: TABS,
  tabColumns: TABS.length,
  selected: 'a',
  items: ITEMS,
};

describe('tabbed-list layout', () => {
  it('lays the tabs out edge to edge across the window content width', () => {
    const layout = layoutTabbedList(base);
    expect(layout.tabs).toHaveLength(4);
    for (let i = 1; i < layout.tabs.length; i++) {
      const previous = layout.tabs[i - 1];
      const tab = layout.tabs[i];
      if (previous === undefined || tab === undefined) throw new Error('missing tab');
      expect(tab.rect.x).toBe(previous.rect.x + previous.rect.w); // no gap, no overlap
      expect(tab.rect.y).toBe(previous.rect.y); // one grid row
    }
    const first = layout.tabs[0];
    const last = layout.tabs[3];
    if (first === undefined || last === undefined) throw new Error('missing tab');
    expect(first.rect.x).toBe(layout.viewport.x); // the grid spans exactly the list's width
    expect(last.rect.x + last.rect.w).toBe(layout.viewport.x + layout.viewport.w);
    expect(first.selected).toBe(true);
  });

  it('wraps the tab grid to as many rows as the column count needs', () => {
    const layout = layoutTabbedList({ ...base, tabColumns: 2 });
    const ys = layout.tabs.map((t) => t.rect.y);
    expect(new Set(ys).size).toBe(2); // four tabs, two per row
    expect(ys[0]).toBe(ys[1]);
    expect(ys[2]).toBe(ys[3]);
    expect(ys[2] ?? 0).toBeGreaterThan(ys[0] ?? 0);
    // The extra tab row pushes the list down, and the window grows by exactly that row.
    const single = layoutTabbedList(base);
    expect(layout.viewport.y - single.viewport.y).toBe(single.tabs[0]?.rect.h);
    expect(layout.window.h - single.window.h).toBe(single.tabs[0]?.rect.h);
  });

  it('hit-tests close > tab > row > window background > miss', () => {
    const layout = layoutTabbedList(base);
    const tab = layout.tabs[2];
    const row = layout.rows[0];
    if (tab === undefined || row === undefined) throw new Error('missing tab/row');

    expect(hitTestTabbedList(layout, tab.rect.x + 1, tab.rect.y + 1)).toEqual({ kind: 'tab', tab: 'c' });
    expect(hitTestTabbedList(layout, row.rect.x + 1, row.rect.y + 1)).toEqual({
      kind: 'row',
      item: row.item,
    });
    expect(hitTestTabbedList(layout, layout.closeRect.x + 1, layout.closeRect.y + 1)).toEqual({
      kind: 'close',
    });
    expect(hitTestTabbedList(layout, layout.window.x + 1, layout.window.y + layout.window.h - 2)).toEqual({
      kind: 'window',
    });
    expect(hitTestTabbedList(layout, 5000, 5000)).toBeNull();
  });

  it('bounds the list to a viewport, clamps the scroll, and pages from the scrollbar track', () => {
    const bounded = { ...base, maxListRows: 4 };
    const top = layoutTabbedList(bounded);
    expect(top.rows.map((r) => r.item.label)).toEqual(['I0', 'I1', 'I2', 'I3']);
    expect(top.scroll).toEqual({ top: 0, max: 6, total: 10, visible: 4 });

    const middle = layoutTabbedList({ ...bounded, scrollTop: 2 });
    expect(middle.rows.map((r) => r.item.label)).toEqual(['I2', 'I3', 'I4', 'I5']);
    const clamped = layoutTabbedList({ ...bounded, scrollTop: 99 });
    expect(clamped.scroll.top).toBe(6);

    const bar = middle.scrollbar;
    if (bar === undefined) throw new Error('expected a scrollbar');
    expect(hitTestTabbedList(middle, bar.track.x + 1, bar.thumb.y - 1)).toEqual({ kind: 'scroll', dir: -1 });
    expect(hitTestTabbedList(middle, bar.track.x + 1, bar.thumb.y + bar.thumb.h + 1)).toEqual({
      kind: 'scroll',
      dir: 1,
    });
    expect(hitTestTabbedList(middle, bar.thumb.x + 1, bar.thumb.y + 1)).toEqual({ kind: 'window' });
    // A row must not run under the gutter the scrollbar reserved.
    expect((middle.rows[0]?.rect.x ?? 0) + (middle.rows[0]?.rect.w ?? 0)).toBeLessThanOrEqual(bar.track.x);
  });

  it('omits the scrollbar when the whole list fits the viewport', () => {
    const layout = layoutTabbedList({ ...base, maxListRows: 20 });
    expect(layout.rows).toHaveLength(10);
    expect(layout.scrollbar).toBeUndefined();
    expect(layout.scroll.max).toBe(0);
  });
});

describe('tabbed-list scale', () => {
  const BUILDINGS: readonly MenuBuildingEntry[] = [{ typeId: 1, label: 'Headquarters', kind: 'storage' }];
  const GOODS: readonly MenuGoodEntry[] = [{ goodType: 3, id: 'wood', label: 'Drewno' }];

  /** Lay a source out the way its window controller does, at one scale. */
  function layoutOf<Id, Item extends { readonly label: string }>(
    source: TabbedListSource<Id, Item>,
    scale: number,
  ) {
    return layoutTabbedList({
      originX: 0,
      originY: 0,
      scale,
      tabs: source.tabs(),
      tabColumns: source.tabColumns,
      selected: source.initialTab,
      items: source.items(source.initialTab),
    });
  }

  // The drift that motivated the shared model: the build menu resolved `?uiscale=` fractionally while
  // the goods palette floored it, so at the 1.4 default the two windows drew at 1.4× and 1× side by side.
  it('resolves a fractional uiscale identically for the build menu and the goods palette', () => {
    for (const scale of [1, DEFAULT_UI_SCALE, 2]) {
      const build = layoutOf(buildingTabbedList(BUILDINGS), scale);
      const goods = layoutOf(goodsTabbedList(GOODS), scale);
      expect(goods.scale).toBe(build.scale);
      expect(goods.scale).toBe(scale); // the fraction survives — this is what the goods palette floored
      expect(goods.window.w).toBe(build.window.w);
      expect(goods.titleRect.h).toBe(build.titleRect.h);
      expect(goods.closeRect.w).toBe(build.closeRect.w);
      expect(goods.rows[0]?.rect.h).toBe(build.rows[0]?.rect.h);
      expect(goods.tabs[0]?.rect.h).toBe(build.tabs[0]?.rect.h);
    }
  });

  it("wraps the palette's eight categories into two rows of the shared window width", () => {
    const goods = layoutOf(goodsTabbedList(GOODS), DEFAULT_UI_SCALE);
    expect(goods.tabs).toHaveLength(8);
    expect(new Set(goods.tabs.map((t) => t.rect.y)).size).toBe(2);
  });

  it('never draws below the pinned 1× geometry', () => {
    expect(layoutOf(buildingTabbedList(BUILDINGS), 0.5).scale).toBe(1);
    expect(layoutOf(goodsTabbedList(GOODS), 0.5).scale).toBe(1);
  });
});
