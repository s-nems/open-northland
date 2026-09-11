import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { FRAME_0, WIDE } from './support.js';

const object = (x: number, decor: boolean): MapObjectSprite => ({
  x,
  y: 0,
  decor,
  source: Texture.WHITE.source,
  frames: [FRAME_0],
  scale: 1,
  phase: 0,
});

describe('incremental map objects', () => {
  it('rebuilds only the changed decor block and never resurrects removed objects', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    const first = object(10, true);
    const distant = object(5000, true);
    layer.set([first, distant]);
    const untouched = layer.decorContainer.children[1];
    const added = object(20, true);
    layer.add([added]);
    expect(layer.decorContainer.children[1]).toBe(untouched);
    expect(layer.decorContainer.children).toHaveLength(2);
    layer.remove(first);
    layer.add([object(30, true)]);
    const updated = layer.decorContainer.children.find((chunk) => chunk !== untouched);
    const mesh = updated?.children[0];
    expect(mesh).toBeDefined();
    const positions = (mesh as unknown as { geometry: { positions: Float32Array } }).geometry.positions;
    expect(positions.length).toBe(16);
    expect(positions[0]).toBe(20);
    layer.destroy();
  });

  it('adds a tall object at an unchanged frame without replacing existing pooled sprites', () => {
    const sprites = new Container();
    const layer = new MapObjectLayer(sprites, new TextureCache());
    layer.set([object(10, false)]);
    layer.update(WIDE, 0);
    const kept = sprites.children[0];
    const added = object(20, false);
    layer.add([added, added]);
    layer.update(WIDE, 0);
    expect(sprites.children).toHaveLength(2);
    expect(sprites.children).toContain(kept);
    layer.remove(added);
    layer.update(WIDE, 0);
    expect(sprites.children).toEqual([kept]);
    layer.destroy();
  });

  it('reclaims empty decor chunks across repeated add/remove cycles', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    for (let i = 0; i < 30; i++) {
      const added = object(i * 5000, true);
      layer.add([added]);
      expect(layer.decorContainer.children).toHaveLength(1);
      layer.remove(added);
      expect(layer.decorContainer.children).toHaveLength(0);
    }
    layer.destroy();
  });
});
