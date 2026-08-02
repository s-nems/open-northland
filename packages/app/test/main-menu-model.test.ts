import { describe, expect, it } from 'vitest';
import {
  backTarget,
  CAMERA_DRIFT_PERIOD_MS,
  CAMERA_DRIFT_RADIUS_X_PX,
  cameraDrift,
  MAIN_NAV,
  type MainNavItem,
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
  });
});

describe('MAIN_NAV', () => {
  it('lists the design order with load and multiplayer as coming-soon rows', () => {
    expect(MAIN_NAV.map((item) => item.id)).toEqual([
      'newGame',
      'loadGame',
      'multiplayer',
      'settings',
      'credits',
      'exit',
    ]);
    expect(MAIN_NAV.filter((item) => item.kind === 'comingSoon').map((item) => item.id)).toEqual([
      'loadGame',
      'multiplayer',
    ]);
  });
});

describe('moveFocus', () => {
  it('skips coming-soon rows in both directions', () => {
    // From "Nowa gra" down: over the two badged rows onto "Ustawienia".
    expect(moveFocus(MAIN_NAV, 0, 1)).toBe(3);
    // From "Ustawienia" up: back over the badged rows onto "Nowa gra".
    expect(moveFocus(MAIN_NAV, 3, -1)).toBe(0);
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
      { id: 'loadGame', kind: 'comingSoon' },
      { id: 'multiplayer', kind: 'comingSoon' },
    ];
    expect(moveFocus(allBadged, 0, 1)).toBe(0);
  });
});

describe('cameraDrift', () => {
  it('starts every lap on the authored frame', () => {
    expect(cameraDrift(0)).toEqual({ dx: 0, dy: 0 });
    const wrapped = cameraDrift(CAMERA_DRIFT_PERIOD_MS);
    expect(wrapped.dx).toBeCloseTo(0);
    expect(wrapped.dy).toBeCloseTo(0);
  });

  it('peaks horizontally at the quarter lap', () => {
    const quarter = cameraDrift(CAMERA_DRIFT_PERIOD_MS / 4);
    expect(quarter.dx).toBeCloseTo(CAMERA_DRIFT_RADIUS_X_PX);
    expect(quarter.dy).toBeCloseTo(0);
  });
});
