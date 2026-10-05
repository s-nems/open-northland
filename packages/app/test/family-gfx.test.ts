import { describe, expect, it } from 'vitest';
import { loadedFamilyEffects, resolveFamilyEffects } from '../src/content/family-gfx.js';

describe('family particle binding', () => {
  it('joins authored names, palettes, frame lists and loop flags without relying on record positions', () => {
    const refs = resolveFamilyEffects({
      particles: [
        {
          index: 4,
          name: 'stork',
          bmd: 'data/flight.bmd',
          paletteName: 'bird',
          frames: [{ valency: 0, bobIds: [8, 3, 9] }],
          loop: false,
          valencyIsDirection: false,
        },
        {
          index: 19,
          name: 'lovehearts',
          bmd: 'data/plume.bmd',
          paletteName: 'red',
          frames: [{ valency: 0, bobIds: [5, 2] }],
          loop: true,
          valencyIsDirection: false,
        },
      ],
    });
    expect(refs.stork).toEqual({
      layer: 'flight.bird',
      valencies: [[8, 3, 9]],
      loop: false,
      directional: false,
    });
    expect(refs.hearts).toEqual({ layer: 'plume.red', valencies: [[5, 2]], loop: true, directional: false });
    expect(loadedFamilyEffects(refs, new Set(['plume.red']))).toEqual({
      hearts: refs.hearts,
      stork: undefined,
    });
    expect(resolveFamilyEffects(null)).toEqual({ hearts: undefined, stork: undefined });
  });
});
