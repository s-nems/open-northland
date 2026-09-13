import { describe, expect, it } from 'vitest';
import { backTarget, MAIN_NAV, moveFocus } from '../src/entries/main-menu/model.js';

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
  it('lists the menu order with multiplayer available', () => {
    expect(MAIN_NAV.map((item) => item.id)).toEqual([
      'newGame',
      'load',
      'multiplayer',
      'settings',
      'credits',
      'exit',
    ]);
    expect(MAIN_NAV.find((item) => item.id === 'multiplayer')?.kind).toBe('open');
  });
});

describe('moveFocus', () => {
  it('includes multiplayer in keyboard navigation', () => {
    expect(moveFocus(MAIN_NAV, 1, 1)).toBe(2);
    expect(moveFocus(MAIN_NAV, 3, -1)).toBe(2);
  });

  it('wraps at both ends', () => {
    expect(moveFocus(MAIN_NAV, MAIN_NAV.length - 1, 1)).toBe(0);
    expect(moveFocus(MAIN_NAV, 0, -1)).toBe(MAIN_NAV.length - 1);
  });

  it('enters the list from the no-focus sentinel used by ArrowDown', () => {
    expect(moveFocus(MAIN_NAV, -1, 1)).toBe(0);
  });
});
