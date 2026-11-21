import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MapObjectLayer, type MapObjectSprite } from '../../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../../src/gpu/textures/texture-cache.js';
import { FRAME_0 } from './support.js';

const FADE = 0.5;

const decor = (x: number, seeThrough: boolean): MapObjectSprite => ({
  x,
  y: 0,
  decor: true,
  ...(seeThrough ? { seeThrough: true as const } : {}),
  source: Texture.WHITE.source,
  frames: [FRAME_0],
  scale: 1,
  phase: 0,
});

/** The alphas of a chunk's meshes, in draw order. */
const alphas = (layer: MapObjectLayer, chunk = 0): number[] =>
  (layer.decorContainer.children[chunk]?.children ?? []).map((mesh) => mesh.alpha);

describe('see-through decor', () => {
  it('fades the flagged decor alone, over the rest of its chunk, and draws it solid again', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([decor(10, true), decor(20, false)]);
    expect(alphas(layer)).toEqual([1, 1]);
    layer.setDecorFade(FADE);
    expect(alphas(layer)).toEqual([1, FADE]);
    layer.setDecorFade(undefined);
    expect(alphas(layer)).toEqual([1, 1]);
    layer.destroy();
  });

  it('fades a chunk off screen once a frame shows it', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([decor(10, true), decor(5000, true)]);
    const near = { minX: 0, minY: -100, maxX: 100, maxY: 100 };
    layer.update(near, 0);
    layer.setDecorFade(FADE);
    expect([alphas(layer, 0), alphas(layer, 1)]).toEqual([[FADE], [1]]);
    layer.update({ ...near, maxX: 6000 }, 0);
    expect(alphas(layer, 1)).toEqual([FADE]);
    layer.destroy();
  });

  it('builds a chunk added under the fade already faded', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([decor(10, false)]);
    layer.setDecorFade(FADE);
    layer.add([decor(5000, true)]);
    expect(alphas(layer, 1)).toEqual([FADE]);
    layer.destroy();
  });
});
