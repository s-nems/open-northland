import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../../src/data/scene/index.js';
import { type BindFrame, LayerBinder } from '../../src/gpu/sprite-pool/bind-layers.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';

const FRAME: BindFrame = { camera: { offsetX: 0, offsetY: 0 }, screenW: 800, screenH: 600 };
const SITE: DrawItem = { kind: 'palisade', ref: 1, x: 0, y: 0, depth: 0, gfxIndex: 691 };

describe('LayerBinder - a wall site keeps its ring until the wall stands', () => {
  it('draws the stake, then the ring under the claim flag, and neither for the built wall', () => {
    const binder = new LayerBinder(new TextureCache(), undefined);
    const pe = binder.create('palisade', SITE);
    let frameId = 0;
    const shown = () => ({
      stake: pe.palisadeSiteMarker?.visible === true,
      ring: pe.palisadeClaimRing?.visible === true,
    });

    binder.bind(pe, { ...SITE, palisadeSite: 'unclaimed' }, [], FRAME, ++frameId);
    expect(shown()).toEqual({ stake: true, ring: false });

    binder.bind(pe, { ...SITE, palisadeSite: 'claimed' }, [], FRAME, ++frameId);
    expect(shown()).toEqual({ stake: false, ring: true });
    // Painted first, so the flag's pole stands in the ring rather than under it.
    expect(pe.container.children[0]).toBe(pe.palisadeClaimRing);

    binder.bind(pe, SITE, [], FRAME, ++frameId);
    expect(shown()).toEqual({ stake: false, ring: false });
  });
});
