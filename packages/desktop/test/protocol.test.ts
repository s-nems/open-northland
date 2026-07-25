import { describe, expect, it } from 'vitest';
import { isAppUrl, isInGameSession, routePathOf } from '../src/protocol-routing.js';

/**
 * The host-folding rule (`src/protocol-routing.ts`): Pixi workers mis-join root-relative asset URLs on a
 * custom scheme, so `/bobs/x.png` arrives as `app://bobs/x.png` with the route segment in the URL
 * host. Both spellings must map to the same content-route path; a regression here silently drops
 * every worker-fetched atlas in the packaged shell.
 */
describe('routePathOf', () => {
  it('passes game-host pathnames through untouched', () => {
    expect(routePathOf('game', '/bobs/ls_trees.tree01.png')).toBe('/bobs/ls_trees.tree01.png');
    expect(routePathOf('game', '/index.html')).toBe('/index.html');
  });

  it('folds a mangled route-segment host back into the pathname', () => {
    expect(routePathOf('bobs', '/ls_trees.tree01.png')).toBe('/bobs/ls_trees.tree01.png');
    expect(routePathOf('maps', '/campaign01.json')).toBe('/maps/campaign01.json');
  });

  it('gives the routeless setup host no route path', () => {
    expect(routePathOf('setup', '/setup.html')).toBeUndefined();
  });

  it('keeps the raw pathname raw — decoding belongs to the shared resolver', () => {
    expect(routePathOf('game', '/maps/two%20words.json')).toBe('/maps/two%20words.json');
  });
});

/** The origin test behind the IPC sender guard and the window's navigation guard. */
describe('isAppUrl', () => {
  it('accepts the shell pages it serves', () => {
    expect(isAppUrl('app://setup/setup.html')).toBe(true);
    expect(isAppUrl('app://game/index.html?lang=pol')).toBe(true);
  });

  it('rejects remote and local-file origins', () => {
    expect(isAppUrl('https://example.com/page')).toBe(false);
    expect(isAppUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects a caller that reports no URL', () => {
    expect(isAppUrl(undefined)).toBe(false);
    expect(isAppUrl('')).toBe(false);
  });

  it('requires the full scheme separator, not the scheme spelling alone', () => {
    expect(isAppUrl('app:/game')).toBe(false);
    expect(isAppUrl('application://game/index.html')).toBe(false);
  });
});

/** The test behind the leave-game confirmation (`src/window.ts`). */
describe('isInGameSession', () => {
  it('sees a session in the world-selecting entries', () => {
    expect(isInGameSession('app://game/index.html?lang=pol&map=campaign01')).toBe(true);
    expect(isInGameSession('app://game/index.html?lang=eng&scene=first-hut')).toBe(true);
  });

  it('sees no session in the main menu, whose URL always carries the installer language', () => {
    expect(isInGameSession('app://game/index.html?lang=pol')).toBe(false);
    expect(isInGameSession('app://game/index.html')).toBe(false);
  });

  it('sees no session on the setup page or off the app scheme', () => {
    expect(isInGameSession('app://setup/setup.html')).toBe(false);
    expect(isInGameSession('https://example.com/index.html?map=campaign01')).toBe(false);
    expect(isInGameSession('not a url')).toBe(false);
  });
});
