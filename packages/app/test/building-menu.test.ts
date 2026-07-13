import { describe, expect, it } from 'vitest';
import {
  BUILDING_CATEGORIES,
  buildingsInCategory,
  categoryOfKind,
  hitTestBuildingMenu,
  layoutBuildingMenu,
  type MenuBuildingEntry,
} from '../src/hud/tool-panel/building-menu.js';

const ENTRIES: readonly MenuBuildingEntry[] = [
  { typeId: 1, label: 'Headquarters', kind: 'storage' },
  { typeId: 2, label: 'Home', kind: 'home' },
  { typeId: 12, label: 'Grain farm', kind: 'workplace' },
  { typeId: 39, label: 'Barracks', kind: 'training' },
  { typeId: 40, label: 'Watchtower', kind: 'tower' },
];

const MANY_ENTRIES: readonly MenuBuildingEntry[] = Array.from({ length: 10 }, (_, index) => ({
  typeId: 100 + index,
  label: `B${index}`,
  kind: 'workplace',
}));

describe('building-menu', () => {
  it('has the five original category tabs with pinned string ids', () => {
    expect(BUILDING_CATEGORIES.map((category) => category.id)).toEqual([
      'all',
      'work',
      'storage',
      'home',
      'military',
    ]);
    expect(BUILDING_CATEGORIES.map((category) => category.label)).toEqual([
      'Wszystko',
      'Praca',
      'Magazyn',
      'Dom',
      'Wojsko',
    ]);
    expect(BUILDING_CATEGORIES.map((category) => category.stringId)).toEqual([2, 3, 4, 5, 6]);
  });

  it('folds kinds into categories', () => {
    expect(categoryOfKind('workplace')).toBe('work');
    expect(categoryOfKind('storage')).toBe('storage');
    expect(categoryOfKind('home')).toBe('home');
    expect(categoryOfKind('tower')).toBe('military');
    expect(categoryOfKind('training')).toBe('military');
  });

  it('filters entries by category, with all returning everything', () => {
    expect(buildingsInCategory(ENTRIES, 'all')).toHaveLength(5);
    expect(buildingsInCategory(ENTRIES, 'home').map((entry) => entry.typeId)).toEqual([2]);
    expect(buildingsInCategory(ENTRIES, 'military').map((entry) => entry.typeId)).toEqual([39, 40]);
    expect(buildingsInCategory(ENTRIES, 'work').map((entry) => entry.typeId)).toEqual([12]);
  });

  it('lays out and hit-tests tabs, buildings, close, window and miss', () => {
    const layout = layoutBuildingMenu(ENTRIES, { originX: 100, originY: 50, scale: 2, selected: 'all' });
    expect(layout.rows).toHaveLength(5);
    expect(layout.tabs).toHaveLength(5);
    const workTab = layout.tabs.find((tab) => tab.category === 'work');
    if (workTab === undefined) throw new Error('missing work tab');
    expect(hitTestBuildingMenu(layout, workTab.rect.x + 1, workTab.rect.y + 1)).toEqual({
      kind: 'tab',
      category: 'work',
    });
    const farmRow = layout.rows.find((row) => row.typeId === 12);
    if (farmRow === undefined) throw new Error('missing farm row');
    expect(hitTestBuildingMenu(layout, farmRow.rect.x + 1, farmRow.rect.y + 1)).toEqual({
      kind: 'building',
      typeId: 12,
    });
    expect(hitTestBuildingMenu(layout, layout.closeRect.x + 1, layout.closeRect.y + 1)).toEqual({
      kind: 'close',
    });
    expect(hitTestBuildingMenu(layout, layout.window.x + 1, layout.window.y + layout.window.h - 2)).toEqual({
      kind: 'window',
    });
    expect(hitTestBuildingMenu(layout, 5000, 5000)).toBeNull();
  });

  it('selecting a category shrinks the visible rows', () => {
    const layout = layoutBuildingMenu(ENTRIES, { originX: 0, originY: 0, scale: 1, selected: 'military' });
    expect(layout.rows.map((row) => row.typeId)).toEqual([39, 40]);
  });

  it('bounds the list to a viewport and clamps scroll', () => {
    const base = { originX: 0, originY: 0, scale: 1, selected: 'all' as const, maxListRows: 4 };
    const top = layoutBuildingMenu(MANY_ENTRIES, base);
    expect(top.rows.map((row) => row.typeId)).toEqual([100, 101, 102, 103]);
    expect(top.scroll).toEqual({ top: 0, max: 6, total: 10, visible: 4 });
    expect(top.scrollbar).toBeDefined();
    const middle = layoutBuildingMenu(MANY_ENTRIES, { ...base, scrollTop: 2 });
    expect(middle.rows.map((row) => row.typeId)).toEqual([102, 103, 104, 105]);
    expect(middle.scroll.top).toBe(2);
    const clamped = layoutBuildingMenu(MANY_ENTRIES, { ...base, scrollTop: 99 });
    expect(clamped.scroll.top).toBe(6);
    expect(clamped.rows.map((row) => row.typeId)).toEqual([106, 107, 108, 109]);
  });

  it('omits the scrollbar when the category fits the viewport', () => {
    const layout = layoutBuildingMenu(MANY_ENTRIES, {
      originX: 0,
      originY: 0,
      scale: 1,
      selected: 'all',
      maxListRows: 20,
    });
    expect(layout.rows).toHaveLength(10);
    expect(layout.scrollbar).toBeUndefined();
    expect(layout.scroll.max).toBe(0);
  });

  it('hit-tests the scrollbar track as a page-scroll toward the click', () => {
    const layout = layoutBuildingMenu(MANY_ENTRIES, {
      originX: 0,
      originY: 0,
      scale: 1,
      selected: 'all',
      maxListRows: 4,
      scrollTop: 3,
    });
    const bar = layout.scrollbar;
    if (bar === undefined) throw new Error('expected a scrollbar');
    expect(hitTestBuildingMenu(layout, bar.track.x + 1, bar.thumb.y - 1)).toEqual({
      kind: 'scroll',
      dir: -1,
    });
    expect(hitTestBuildingMenu(layout, bar.track.x + 1, bar.thumb.y + bar.thumb.h + 1)).toEqual({
      kind: 'scroll',
      dir: 1,
    });
    expect(hitTestBuildingMenu(layout, bar.thumb.x + 1, bar.thumb.y + 1)).toEqual({ kind: 'window' });
  });
});
