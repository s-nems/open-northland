import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { VIEW_DETAILS } from '../../../src/data/view-detail.js';
import { MapObjectLayer, type MapObjectSprite } from '../../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { FRAME_0, FRAME_1, tallSprites, WIDE } from './support.js';

/** A tier without landscape motion holds a looping tall object on its first frame, the frame the sprite
 *  pool holds a looping node on, while a one-shot clip plays on. */

const tree = (extra: Partial<MapObjectSprite> = {}): MapObjectSprite => ({
  x: 0,
  y: 0,
  source: Texture.WHITE.source,
  frames: [FRAME_0, FRAME_1],
  scale: 1,
  decor: false,
  phase: 1,
  ...extra,
});

function layerOf(obj: MapObjectSprite): { layer: MapObjectLayer; frameX: () => number | undefined } {
  const sprites = new Container();
  const layer = new MapObjectLayer(sprites, new TextureCache());
  layer.set([obj]);
  return { layer, frameX: () => tallSprites(sprites)[0]?.frameX };
}

describe('MapObjectLayer under a detail tier (tall loops)', () => {
  it('holds a loop on its first frame whatever its phase, and plays it again at full detail', () => {
    const { layer, frameX } = layerOf(tree());
    layer.update(WIDE, 0);
    expect(frameX()).toBe(FRAME_1.x);

    layer.setDetail(VIEW_DETAILS.reduced);
    for (const tick of [0, 1, 2]) {
      layer.update(WIDE, tick);
      expect(frameX()).toBe(FRAME_0.x);
    }

    layer.setDetail(VIEW_DETAILS.full);
    layer.update(WIDE, 2);
    expect(frameX()).toBe(FRAME_1.x);
  });

  it('keeps a one-shot clip playing', () => {
    const { layer, frameX } = layerOf(tree({ once: { from: 0, rest: null } }));
    layer.setDetail(VIEW_DETAILS.reduced);
    layer.update(WIDE, 0);
    expect(frameX()).toBe(FRAME_0.x);
    layer.update(WIDE, 1);
    expect(frameX()).toBe(FRAME_1.x);
  });
});
