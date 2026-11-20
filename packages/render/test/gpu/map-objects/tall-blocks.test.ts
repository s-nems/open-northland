import { Container, type Sprite, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { FOOT_OVERLAY_STRIPS, type GroundFootPart } from '../../../src/gpu/ground-foot/index.js';
import { MapObjectLayer } from '../../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { FRAME_0, WIDE } from './support.js';

describe('grounded tall objects', () => {
  it('draws each overlay strip the cache bakes, the shade under the body and the cover over it', () => {
    const textures = new TextureCache();
    const body = new Texture();
    const shades = [new Texture(), new Texture()];
    const covers = [new Texture()];
    vi.spyOn(textures, 'groundedPart').mockImplementation((part: GroundFootPart, ...rest) => {
      const strip = rest[6] ?? 0;
      return part === 'body' ? body : ((part === 'shade' ? shades : covers)[strip] ?? null);
    });
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, textures);
    layer.set([
      {
        x: 0,
        y: 0,
        source: Texture.WHITE.source,
        frames: [FRAME_0],
        scale: 1,
        decor: false,
        phase: 0,
        grounded: true,
      },
    ]);
    layer.update(WIDE, 0);

    const sprites = spriteLayer.children as Sprite[];
    expect(sprites).toHaveLength(1 + 2 * FOOT_OVERLAY_STRIPS);
    const drawn = sprites.filter((s) => s.visible);
    const bodySprite = drawn.find((s) => s.texture === body);
    const depth = bodySprite?.zIndex ?? Number.NaN;
    expect(drawn.filter((s) => shades.includes(s.texture)).every((s) => s.zIndex < depth)).toBe(true);
    expect(drawn.filter((s) => covers.includes(s.texture)).every((s) => s.zIndex > depth)).toBe(true);
    expect(drawn.map((s) => s.texture)).toHaveLength(1 + shades.length + covers.length);
  });
});

describe('tall objects as occlusion ghost occluders', () => {
  it('lists each visible tall object once per update, however many frames ran', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([
      { x: 0, y: 0, source: Texture.WHITE.source, frames: [FRAME_0], scale: 1, decor: false, phase: 0 },
    ]);
    for (let tick = 0; tick < 5; tick++)
      layer.update(WIDE, tick, undefined, undefined, tick, undefined, true);
    expect(layer.tallOccluders).toHaveLength(1);
    // Off, the scan reads an empty list.
    layer.update(WIDE, 5, undefined, undefined, 5, undefined, false);
    expect(layer.tallOccluders).toHaveLength(0);
  });

  it("fades the occluder's body and its cast shadow together, and restores both", () => {
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, new TextureCache());
    layer.set([
      {
        x: 0,
        y: 0,
        source: Texture.WHITE.source,
        frames: [FRAME_0],
        scale: 1,
        decor: false,
        phase: 0,
        shadow: { source: Texture.WHITE.source, frames: [FRAME_0] },
      },
    ]);
    layer.update(WIDE, 0, undefined, undefined, 0, undefined, true);
    const occluder = layer.tallOccluders[0];
    if (occluder === undefined) throw new Error('the tree drew no occluder');
    const sprites = spriteLayer.children as Sprite[];
    expect(sprites.length).toBe(2);
    occluder.setFade?.(0.45);
    expect(sprites.every((s) => s.alpha === 0.45)).toBe(true);
    occluder.setFade?.(undefined);
    expect(sprites.every((s) => s.alpha === 1)).toBe(true);
  });
});
