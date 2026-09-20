import { describe, expect, it } from 'vitest';
import {
  BUILDING_CATEGORIES,
  CATALOGUE_KINDS,
  categoryOfKind,
  INITIAL_CONSTRUCTION_STATE,
} from '../src/hud/tool-panel/building-menu.js';

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

  it('opens on the catalogue page, the all tab, in the grid view with nothing picked', () => {
    expect(INITIAL_CONSTRUCTION_STATE).toEqual({
      page: 'catalog',
      category: 'all',
      view: 'grid',
      scrollTop: 0,
      picked: null,
      suspended: false,
    });
  });
});
