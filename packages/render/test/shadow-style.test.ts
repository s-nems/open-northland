import { Sprite, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { isShadowTexture } from '../src/gpu/pixel-art-registry.js';
import { DEFAULT_SHADOW_STYLE, setCastShadowTransform } from '../src/gpu/shadow-style.js';
import { TextureCache } from '../src/gpu/texture-cache.js';

const SOURCE = new TextureSource({ width: 64, height: 64 });

describe('setCastShadowTransform', () => {
  /** A settler-sized body frame: 34 px tall, drawn from 27 px above the feet anchor to 7 px below it. */
  const BODY = { ox: -10, oy: -27, height: 34 };
  const scale = 1;

  it('projects the top of the body to feet + height x (shear, -flatten)', () => {
    const spr = new Sprite();
    setCastShadowTransform(spr, scale, DEFAULT_SHADOW_STYLE, BODY.ox, BODY.oy);
    spr.updateLocalTransform();
    const m = spr.localTransform;
    // The frame's top-left corner, in the drawing container's feet-local px.
    expect(m.tx).toBeCloseTo(BODY.ox - DEFAULT_SHADOW_STYLE.castShear * BODY.oy);
    expect(m.ty).toBeCloseTo(DEFAULT_SHADOW_STYLE.castFlatten * BODY.oy);
    // A point 27 px above the feet lands 27 x shear to the right and 27 x flatten above them.
    expect(m.tx).toBeCloseTo(BODY.ox + 10.8);
    expect(m.ty).toBeCloseTo(-6.75);
  });

  it('shears right with height and flattens the frame, leaving columns vertical', () => {
    const spr = new Sprite();
    setCastShadowTransform(spr, scale, DEFAULT_SHADOW_STYLE, BODY.ox, BODY.oy);
    spr.updateLocalTransform();
    const m = spr.localTransform;
    expect(m.a).toBeCloseTo(scale); // horizontal size unchanged
    expect(m.b).toBeCloseTo(0); // a frame row stays a screen row
    expect(m.c).toBeCloseTo(-DEFAULT_SHADOW_STYLE.castShear * scale);
    expect(m.d).toBeCloseTo(DEFAULT_SHADOW_STYLE.castFlatten * scale);
    // The whole frame collapses to `flatten` of its own height.
    expect(m.d * BODY.height).toBeCloseTo(8.5);
    spr.destroy();
  });

  it('scales the projection with the layer art scale', () => {
    const spr = new Sprite();
    setCastShadowTransform(spr, 2, DEFAULT_SHADOW_STYLE, BODY.ox, BODY.oy);
    spr.updateLocalTransform();
    const m = spr.localTransform;
    expect(m.a).toBeCloseTo(2);
    expect(m.c).toBeCloseTo(-DEFAULT_SHADOW_STYLE.castShear * 2);
    expect(m.d).toBeCloseTo(DEFAULT_SHADOW_STYLE.castFlatten * 2);
    spr.destroy();
  });
});

describe('TextureCache.castSilhouette', () => {
  const frame = { x: 4, y: 8, width: 16, height: 32, offsetX: -8, offsetY: -27 };

  it('marks a view of the body frame as a shadow without marking the body draw', () => {
    const cache = new TextureCache();
    const cast = cache.castSilhouette(SOURCE, frame);
    const body = cache.get(SOURCE, frame);
    expect(cast).not.toBe(body);
    expect(isShadowTexture(cast)).toBe(true);
    expect(isShadowTexture(body)).toBe(false);
    expect(cast.frame.x).toBe(frame.x);
    expect(cast.frame.height).toBe(frame.height);
  });

  it('reuses one view per frame and keeps the page out of the linear-sampling flip', () => {
    const cache = new TextureCache();
    expect(cache.castSilhouette(SOURCE, frame)).toBe(cache.castSilhouette(SOURCE, frame));
    // An indexed character page must stay nearest-sampled: casting from it cannot enrol it.
    expect(cache.pageSources().has(SOURCE)).toBe(false);
  });

  it('marks a silhouette atlas frame on the shadow path, whichever branch serves it', () => {
    const cache = new TextureCache();
    expect(isShadowTexture(cache.getShadow(SOURCE, frame))).toBe(true);
  });
});
