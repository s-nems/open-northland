import { describe, expect, it } from 'vitest';
import {
  BUILDING_CATEGORIES,
  buildingsInCategory,
  buildingTabbedList,
  categoryOfKind,
  type MenuBuildingEntry,
} from '../src/hud/tool-panel/building-menu.js';

const ENTRIES: readonly MenuBuildingEntry[] = [
  { typeId: 1, label: 'Headquarters', kind: 'storage' },
  { typeId: 2, label: 'Home', kind: 'home' },
  { typeId: 12, label: 'Grain farm', kind: 'workplace' },
  { typeId: 39, label: 'Barracks', kind: 'training' },
  { typeId: 40, label: 'Watchtower', kind: 'tower' },
];

describe('building-menu', () => {
  it('has the five original category tabs with pinned string ids', () => {
    expect(BUILDING_CATEGORIES.map((category) => category.id)).toEqual([
      'all',
      'work',
      'storage',
      'home',
      'military',
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

  it('exposes the categories as one tabbed-list row of localized tabs, opening on Wszystko', () => {
    const source = buildingTabbedList(ENTRIES);
    expect(source.tabs().map((tab) => tab.label)).toEqual(['Wszystko', 'Praca', 'Magazyn', 'Dom', 'Wojsko']);
    expect(source.tabs().map((tab) => tab.stringId)).toEqual([2, 3, 4, 5, 6]);
    expect(source.tabColumns).toBe(BUILDING_CATEGORIES.length); // all five side by side
    expect(source.initialTab).toBe('all');
    expect(source.items('military').map((entry) => entry.typeId)).toEqual([39, 40]);
  });
});
