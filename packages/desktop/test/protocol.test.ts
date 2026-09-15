import { describe, expect, it } from 'vitest';
import { isAppUrl, routePathOf } from '../src/protocol-routing.js';

/**
 * Pixi workers mis-join root-relative asset URLs on a custom scheme, so `/bobs/x.png` arrives as
 * `app://bobs/x.png` with the route segment in the URL host.
 */
describe('routePathOf', () => {
  it('passes game-host pathnames through untouched', () => {
    expect(routePathOf('game', '/bobs/ls_trees.tree01.png')).toBe('/bobs/ls_trees.tree01.png');
    expect(routePathOf('game', '/index.html')).toBe('/index.html');
  });

  it('folds a mangled route-segment host back into the pathname', () => {
    expect(routePathOf('bobs', '/ls_trees.tree01.png')).toBe('/bobs/ls_trees.tree01.png');
    expect(routePathOf('maps', '/campaign01.json')).toBe('/maps/campaign01.json');
    expect(routePathOf('assets', '/gravel-DqJ8dxXq.png')).toBe('/assets/gravel-DqJ8dxXq.png');
  });

  it('keeps the raw pathname raw - the file lookup decodes it', () => {
    expect(routePathOf('game', '/maps/two%20words.json')).toBe('/maps/two%20words.json');
  });
});

describe('isAppUrl', () => {
  it('accepts the game pages it serves', () => {
    expect(isAppUrl('app://game/index.html')).toBe(true);
    expect(isAppUrl('app://game/index.html?map=campaign01')).toBe(true);
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
