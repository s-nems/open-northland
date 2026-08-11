import { describe, expect, it } from 'vitest';
import { contentRouteOf } from '../src/sw/route.js';

describe('contentRouteOf', () => {
  const ORIGIN = 'https://game.opennorthland.org';
  const routeAt = (swPath: string, url: string): string | undefined =>
    contentRouteOf(swPath, new URL(url, ORIGIN), ORIGIN);

  it('answers the app content routes under the site the worker was served from', () => {
    expect(routeAt('/sw.js', `${ORIGIN}/play/maps-index`)).toBe('/maps-index');
    expect(routeAt('/sw.js', `${ORIGIN}/play/ir.json`)).toBe('/ir.json');
    expect(routeAt('/sw.js', `${ORIGIN}/play/maps/lostvalley.json`)).toBe('/maps/lostvalley.json');
  });

  it('follows the worker to a mount point instead of assuming the origin root', () => {
    expect(routeAt('/shell/sw.js', `${ORIGIN}/shell/play/maps-index`)).toBe('/maps-index');
    expect(routeAt('/shell/sw.js', `${ORIGIN}/play/maps-index`)).toBeUndefined();
  });

  it('leaves everything that is not a content route to the host', () => {
    expect(routeAt('/sw.js', `${ORIGIN}/play/`)).toBeUndefined();
    expect(routeAt('/sw.js', `${ORIGIN}/play/index.html`)).toBeUndefined();
    expect(routeAt('/sw.js', `${ORIGIN}/play/assets/index-abcd1234.js`)).toBeUndefined();
    expect(routeAt('/sw.js', `${ORIGIN}/cnmod.zip`)).toBeUndefined();
    expect(routeAt('/sw.js', `${ORIGIN}/playground/maps-index`)).toBeUndefined();
    expect(routeAt('/sw.js', 'https://elsewhere.example/play/maps-index')).toBeUndefined();
  });
});
