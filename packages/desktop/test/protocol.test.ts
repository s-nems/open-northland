import { describe, expect, it } from 'vitest';
import { routePathOf } from '../src/protocol-routing.js';

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
