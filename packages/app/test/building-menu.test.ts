import { describe, expect, it } from 'vitest';
import {
  BUILDING_CATEGORIES,
  buildingsInCategory,
  CATALOGUE_KINDS,
  categoryOfKind,
  INITIAL_CONSTRUCTION_STATE,
  type MenuBuildingEntry,
} from '../src/hud/tool-panel/building-menu.js';

const ENTRIES: readonly MenuBuildingEntry[] = [
  { typeId: 7, label: 'Stock', kind: 'storage', cost: [] },
  { typeId: 2, label: 'Home', kind: 'home', cost: [] },
  { typeId: 12, label: 'Grain farm', kind: 'workplace', cost: [] },
  { typeId: 39, label: 'Barracks', kind: 'training', cost: [] },
  { typeId: 40, label: 'Watchtower', kind: 'tower', cost: [] },
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

  it('lists the house kinds and leaves vehicles and wonders to their workshops', () => {
    expect([...CATALOGUE_KINDS].sort()).toEqual(['home', 'storage', 'tower', 'training', 'workplace']);
    expect(CATALOGUE_KINDS.has('vehicle')).toBe(false);
    expect(CATALOGUE_KINDS.has('wonder')).toBe(false);
  });

  it('filters entries by category, with all returning everything', () => {
    expect(buildingsInCategory(ENTRIES, 'all')).toHaveLength(5);
    expect(buildingsInCategory(ENTRIES, 'home').map((entry) => entry.typeId)).toEqual([2]);
    expect(buildingsInCategory(ENTRIES, 'military').map((entry) => entry.typeId)).toEqual([39, 40]);
    expect(buildingsInCategory(ENTRIES, 'work').map((entry) => entry.typeId)).toEqual([12]);
  });

  it('opens on the all tab in the grid view with nothing picked', () => {
    expect(INITIAL_CONSTRUCTION_STATE).toEqual({
      category: 'all',
      view: 'grid',
      scrollTop: 0,
      picked: null,
      suspended: false,
    });
  });
});
