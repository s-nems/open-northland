import { describe, expect, it } from 'vitest';
import {
  isStaleCodeError,
  menuSearch,
  parseServedBuild,
  placeOfRoute,
  type ServedBuild,
  type UpdateSituation,
  updateOffer,
} from '../src/update/model.js';

const OLD_BUILD = '/assets/index-Old.js';
const NEW_BUILD = '/assets/index-New.js';
const RESTORE = 'a'.repeat(64);
const SERVED: ServedBuild = { version: '0.0.2', build: NEW_BUILD, restore: RESTORE };

function situation(overrides: Partial<UpdateSituation> = {}): UpdateSituation {
  return {
    runningBuild: OLD_BUILD,
    served: SERVED,
    cause: 'routine',
    place: 'menu',
    carriedRestore: null,
    reloadedFor: null,
    ...overrides,
  };
}

describe('updateOffer', () => {
  it('stays quiet while the host serves this build', () => {
    expect(updateOffer(situation({ runningBuild: NEW_BUILD }))).toEqual({ kind: 'none' });
  });

  it('tells a rebuild under the same version from the running build', () => {
    expect(updateOffer(situation({ served: { ...SERVED, version: '0.0.1' } }))).toEqual({
      kind: 'countdown',
    });
  });

  it('counts down in the menu and leaves a relayed game running', () => {
    expect(updateOffer(situation())).toEqual({ kind: 'countdown' });
    expect(updateOffer(situation({ place: 'relayGame' }))).toEqual({ kind: 'finishThenReload' });
  });

  it('carries a local game over only into a build that restores its save', () => {
    const local = situation({ place: 'localGame', carriedRestore: RESTORE });
    expect(updateOffer(local)).toEqual({ kind: 'continue' });
    expect(updateOffer({ ...local, served: { ...SERVED, restore: 'b'.repeat(64) } })).toEqual({
      kind: 'finishOrReload',
    });
    // A build without content cannot vouch for a restore, even to a tab equally unsure.
    expect(updateOffer({ ...local, served: { ...SERVED, restore: null }, carriedRestore: null })).toEqual({
      kind: 'finishOrReload',
    });
    expect(updateOffer({ ...local, carriedRestore: null })).toEqual({ kind: 'finishOrReload' });
  });

  it('reloads at once on stale code or a relay restart, out of a room that is gone', () => {
    expect(updateOffer(situation({ cause: 'staleCode', place: 'localGame' }))).toEqual({
      kind: 'reloadNow',
      toMenu: false,
      carry: false,
    });
    expect(updateOffer(situation({ cause: 'staleCode', place: 'relayGame' }))).toEqual({
      kind: 'reloadNow',
      toMenu: true,
      carry: false,
    });
    expect(updateOffer(situation({ cause: 'relayRestart', place: 'menu' }))).toEqual({
      kind: 'reloadNow',
      toMenu: true,
      carry: false,
    });
  });

  it('carries a local game over a stale-code reload when the new build restores its save', () => {
    expect(
      updateOffer(situation({ cause: 'staleCode', place: 'localGame', carriedRestore: RESTORE })),
    ).toEqual({
      kind: 'reloadNow',
      toMenu: false,
      carry: true,
    });
  });

  it('never reloads twice into the same build', () => {
    expect(updateOffer(situation({ reloadedFor: NEW_BUILD, cause: 'staleCode' }))).toEqual({
      kind: 'manual',
    });
    expect(updateOffer(situation({ reloadedFor: OLD_BUILD }))).toEqual({ kind: 'countdown' });
  });
});

describe('isStaleCodeError', () => {
  it('knows a module that failed to load in each engine, and nothing else', () => {
    expect(isStaleCodeError('Failed to fetch dynamically imported module: https://x/assets/map-A.js')).toBe(
      true,
    );
    expect(isStaleCodeError('error loading dynamically imported module: https://x/assets/map-A.js')).toBe(
      true,
    );
    expect(isStaleCodeError('Importing a module script failed.')).toBe(true);
    expect(isStaleCodeError('ResizeObserver loop completed with undelivered notifications.')).toBe(false);
    expect(isStaleCodeError("Cannot read properties of undefined (reading 'tick')")).toBe(false);
  });
});

describe('placeOfRoute', () => {
  it('treats tools as the menu and tells local from relayed games', () => {
    expect(placeOfRoute('anim')).toBe('menu');
    expect(placeOfRoute('map')).toBe('localGame');
    expect(placeOfRoute('scene')).toBe('localGame');
    expect(placeOfRoute('relay')).toBe('relayGame');
  });
});

describe('parseServedBuild', () => {
  it('reads the release, its entry script and its restore identity', () => {
    expect(parseServedBuild(SERVED)).toEqual(SERVED);
    expect(parseServedBuild({ ...SERVED, restore: null })).toEqual({ ...SERVED, restore: null });
  });

  it('rejects anything else', () => {
    expect(parseServedBuild(null)).toBeNull();
    expect(parseServedBuild('<html>')).toBeNull();
    expect(parseServedBuild({ version: '0.0.2', build: NEW_BUILD })).toBeNull();
    expect(parseServedBuild({ ...SERVED, version: '' })).toBeNull();
    expect(parseServedBuild({ ...SERVED, build: 'assets/index.js' })).toBeNull();
    expect(parseServedBuild({ ...SERVED, restore: 58 })).toBeNull();
  });
});

describe('menuSearch', () => {
  it('keeps only the language', () => {
    expect(menuSearch('?relay=wss%3A%2F%2Fr&room=abc&lang=pl')).toBe('?lang=pl');
    expect(menuSearch('?relay=wss%3A%2F%2Fr&room=abc')).toBe('');
  });
});
