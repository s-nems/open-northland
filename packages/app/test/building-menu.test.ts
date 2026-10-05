import { describe, expect, it } from 'vitest';
import {
  BUILDING_CATEGORIES,
  CATALOGUE_KINDS,
  categoryOfKind,
  INITIAL_CONSTRUCTION_STATE,
  nationChoice,
} from '../src/hud/tool-panel/building-menu.js';

const VIKING = 1;
const FRANK = 2;
const SARACEN = 4;

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

  it("opens on the catalogue page of the seat's own nation, the all tab, in the grid view with nothing picked", () => {
    expect(INITIAL_CONSTRUCTION_STATE).toEqual({
      page: 'catalog',
      tribe: null,
      category: 'all',
      query: '',
      view: 'grid',
      scrollTop: 0,
      picked: null,
      suspended: false,
    });
  });

  it('shows the nation switch only when the seat may build houses of more than one nation', () => {
    expect(nationChoice(null, [VIKING], VIKING)).toEqual({
      nations: [VIKING],
      shown: VIKING,
      switchable: false,
    });
    expect(nationChoice(null, [], VIKING)).toEqual({ nations: [VIKING], shown: VIKING, switchable: false });
    expect(nationChoice(null, [VIKING, FRANK], VIKING)).toEqual({
      nations: [VIKING, FRANK],
      shown: VIKING,
      switchable: true,
    });
  });

  it("lists the chosen nation while it is offered and falls back to the seat's own once it is not", () => {
    expect(nationChoice(FRANK, [VIKING, FRANK, SARACEN], VIKING).shown).toBe(FRANK);
    expect(nationChoice(FRANK, [VIKING, SARACEN], VIKING).shown).toBe(VIKING);
    expect(nationChoice(FRANK, [VIKING], VIKING)).toMatchObject({ shown: VIKING, switchable: false });
  });
});
