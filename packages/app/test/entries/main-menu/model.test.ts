import { describe, expect, it } from 'vitest';
import {
  backTarget,
  deepLinkScreen,
  MAIN_NAV,
  mainNavFor,
  moveFocus,
} from '../../../src/entries/main-menu/model.js';

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
    expect(backTarget('knowledge')).toBe('main');
  });
});

describe('MAIN_NAV', () => {
  it('lists Knowledge between the map catalogue and the settings', () => {
    const order = MAIN_NAV.map((item) => item.id);
    expect(order.indexOf('knowledge')).toBe(order.indexOf('catalogue') + 1);
    expect(order.indexOf('settings')).toBe(order.indexOf('knowledge') + 1);
  });
});

describe('deepLinkScreen', () => {
  it('opens ?menu=knowledge on its screen', () => {
    expect(deepLinkScreen('knowledge')).toEqual({ screen: 'knowledge', content: null });
  });

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
  it('offers the exit only in the desktop shell, since a page cannot close its browser tab', () => {
    expect(mainNavFor(false).map((item) => item.id)).toContain('exit');
    expect(mainNavFor(true).map((item) => item.id)).not.toContain('exit');
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
