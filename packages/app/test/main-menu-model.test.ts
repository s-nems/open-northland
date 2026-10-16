import { describe, expect, it } from 'vitest';
import {
  backTarget,
  deepLinkScreen,
  MAIN_NAV,
  mainNavFor,
  moveFocus,
} from '../src/entries/main-menu/model.js';

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
    expect(backTarget('catalogue')).toBe('main');
  });
});

describe('deepLinkScreen', () => {
  it('opens ?menu=campaign as New Game on its Campaign tab', () => {
    expect(deepLinkScreen('campaign')).toEqual({ screen: 'newGame', content: 'campaign' });
  });

  it('opens multiplayer directly and anything else on the main screen', () => {
    expect(deepLinkScreen('multiplayer')).toEqual({ screen: 'multiplayer', content: null });
    expect(deepLinkScreen(null)).toEqual({ screen: 'main', content: null });
    expect(deepLinkScreen('lobby')).toEqual({ screen: 'main', content: null });
  });
});

describe('MAIN_NAV', () => {
  it('lists the menu order with multiplayer available and credits hidden', () => {
    expect(MAIN_NAV.map((item) => item.id)).toEqual([
      'newGame',
      'load',
      'multiplayer',
      'catalogue',
      'settings',
      'exit',
    ]);
    expect(MAIN_NAV.find((item) => item.id === 'multiplayer')?.kind).toBe('open');
  });

  it('offers the exit only in the desktop shell, since a page cannot close its browser tab', () => {
    expect(mainNavFor(false).map((item) => item.id)).toContain('exit');
    expect(mainNavFor(true).map((item) => item.id)).toEqual([
      'newGame',
      'load',
      'multiplayer',
      'catalogue',
      'settings',
    ]);
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
