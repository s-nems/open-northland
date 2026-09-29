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
      stake: pe.siteMarker?.visible === true,
      ring: pe.siteClaimMarker?.visible === true,
    });

    binder.bind(pe, { ...SITE, palisadeSite: 'unclaimed' }, [], FRAME, ++frameId);
    expect(shown()).toEqual({ stake: true, ring: false });

    binder.bind(pe, { ...SITE, palisadeSite: 'claimed' }, [], FRAME, ++frameId);
    expect(shown()).toEqual({ stake: false, ring: true });
    // Painted first, so the flag's pole stands in the ring rather than under it.
    expect(pe.container.children[0]).toBe(pe.siteClaimMarker);

    binder.bind(pe, SITE, [], FRAME, ++frameId);
    expect(shown()).toEqual({ stake: false, ring: false });
  });
});

const ROAD: DrawItem = { kind: 'roadsite', ref: 2, x: 0, y: 0, depth: 0 };

describe('LayerBinder - a road site keeps its plot until the road is paved', () => {
  it('draws the pegged plot, then the bare plot under the claim flag', () => {
    const binder = new LayerBinder(new TextureCache(), undefined);
    const pe = binder.create('roadsite', ROAD);
    let frameId = 0;
    const shown = () => ({
      plot: pe.siteMarker?.visible === true,
      claimed: pe.siteClaimMarker?.visible === true,
    });

    binder.bind(pe, { ...ROAD, roadSite: 'unclaimed' }, [], FRAME, ++frameId);
    expect(shown()).toEqual({ plot: true, claimed: false });
    expect(pe.boundsFrame).toBe(frameId);

    binder.bind(pe, { ...ROAD, roadSite: 'claimed' }, [], FRAME, ++frameId);
    expect(shown()).toEqual({ plot: false, claimed: true });
    expect(pe.container.children[0]).toBe(pe.siteClaimMarker);
  });
});
