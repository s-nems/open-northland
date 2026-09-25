import { describe, expect, it } from 'vitest';
import type { DrawItem } from '../../src/data/scene/index.js';
import { type BindFrame, LayerBinder } from '../../src/gpu/sprite-pool/bind-layers.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';

const FRAME: BindFrame = { camera: { offsetX: 0, offsetY: 0 }, screenW: 800, screenH: 600 };
const SITE: DrawItem = { kind: 'palisade', ref: 1, x: 0, y: 0, depth: 0, gfxIndex: 691 };

describe('LayerBinder - a wall site keeps its marker until the wall stands', () => {
  it('draws the marker alone, then over the claim flag, and drops it for the built wall', () => {
    const binder = new LayerBinder(new TextureCache(), undefined);
    const pe = binder.create('palisade', SITE);
    let frameId = 0;
    const marker = (): boolean => pe.palisadeSiteMarker?.visible === true;
    const onTop = (): boolean => pe.container.children.at(-1) === pe.palisadeSiteMarker;

    binder.bind(pe, { ...SITE, palisadeSite: 'unclaimed' }, [], FRAME, ++frameId);
    expect(marker()).toBe(true);

    binder.bind(pe, { ...SITE, palisadeSite: 'claimed' }, [], FRAME, ++frameId);
    expect(marker()).toBe(true);
    expect(onTop()).toBe(true);

    binder.bind(pe, SITE, [], FRAME, ++frameId);
    expect(marker()).toBe(false);
  });
});
