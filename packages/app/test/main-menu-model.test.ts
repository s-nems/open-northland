import { describe, expect, it } from 'vitest';
import { backTarget, MAIN_NAV, type MainNavItem, moveFocus } from '../src/entries/main-menu/model.js';

describe('backTarget', () => {
  it('keeps Esc inert on the main screen', () => {
    expect(backTarget('main')).toBeNull();
  });

  it('returns one level: lobby to map select, every other sub-screen to main', () => {
    expect(backTarget('lobby')).toBe('newGame');
    expect(backTarget('newGame')).toBe('main');
    expect(backTarget('load')).toBe('main');
    expect(backTarget('settings')).toBe('main');
    expect(backTarget('credits')).toBe('main');
  });
});

describe('MAIN_NAV', () => {
  it('lists the design order with multiplayer as the one coming-soon row', () => {
    expect(MAIN_NAV.map((item) => item.id)).toEqual([
      'newGame',
      'load',
      'multiplayer',
      'settings',
      'credits',
      'exit',
    ]);
    expect(MAIN_NAV.filter((item) => item.kind === 'comingSoon').map((item) => item.id)).toEqual([
      'multiplayer',
    ]);
  });
});

describe('moveFocus', () => {
  it('skips coming-soon rows in both directions', () => {
    // From "Wczytaj grę" down: over the badged multiplayer row onto "Ustawienia".
    expect(moveFocus(MAIN_NAV, 1, 1)).toBe(3);
    // From "Ustawienia" up: back over the badged row onto "Wczytaj grę".
    expect(moveFocus(MAIN_NAV, 3, -1)).toBe(1);
  });

  it('wraps at both ends', () => {
    expect(moveFocus(MAIN_NAV, MAIN_NAV.length - 1, 1)).toBe(0);
    expect(moveFocus(MAIN_NAV, 0, -1)).toBe(MAIN_NAV.length - 1);
  });

  it('enters the list from the no-focus sentinel used by ArrowDown', () => {
    expect(moveFocus(MAIN_NAV, -1, 1)).toBe(0);
  });

  it('stays put when nothing is interactive', () => {
    const allBadged: readonly MainNavItem[] = [
      { id: 'multiplayer', kind: 'comingSoon' },
      { id: 'multiplayer', kind: 'comingSoon' },
    ];
    expect(moveFocus(allBadged, 0, 1)).toBe(0);
  });
});
