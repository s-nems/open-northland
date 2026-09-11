import { describe, expect, it } from 'vitest';
import { ownTerrainBindings } from '../src/content/own-assets/bindings.js';

describe('own-only terrain bindings', () => {
  it('keeps missing ground and all six transition pairs visible without original page keys', () => {
    const grass = { pageKey: 'own-grass', coordsA: [0, 0, 63, 63, 0, 63], coordsB: [0, 0, 63, 0, 63, 63] };
    const textures = ownTerrainBindings(new Map(), new Map([['covered', grass]]));
    expect(textures.groundFor?.('covered')).toBe(grass);
    expect(textures.groundFor?.('unknown')?.pageKey).toBe('missing-ground');
    expect(textures.cellFor(999)?.pageKey).toBe('missing-ground');
    const transition = textures.transitionFor?.('unknown');
    expect(transition?.pageKey).toBe('missing-transition');
    expect(transition?.coordsA).toHaveLength(6);
    expect(transition?.coordsB).toHaveLength(6);
    expect(textures.pages.size).toBe(0);
  });
});
