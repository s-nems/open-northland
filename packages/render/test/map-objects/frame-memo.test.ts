import { FOG_STATE } from '@open-northland/sim';
import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { FRAME_0, FRAME_1, WIDE } from './support.js';

/** A two-frame tall object anchored at the origin, cell (0, 0). */
function swayingTree(): MapObjectSprite {
  return {
    x: 0,
    y: 0,
    source: Texture.WHITE.source,
    frames: [FRAME_0, FRAME_1],
    scale: 1,
    decor: false,
    phase: 0,
  };
}

/** The fog probe doubles as the walk detector: a skipped frame probes no cell. */
describe('MapObjectLayer - identical frames skip the walk', () => {
  it('skips on an identical (viewport, tick, epoch) frame and walks again when any of them moves', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([swayingTree()]);
    let probes = 0;
    const state = () => {
      probes++;
      return FOG_STATE.VISIBLE;
    };

    layer.update(WIDE, 0, state, 1);
    const walked = probes;
    expect(walked).toBeGreaterThan(0);

    layer.update(WIDE, 0, state, 1);
    expect(probes).toBe(walked);

    layer.update(WIDE, 1, state, 1);
    expect(probes).toBeGreaterThan(walked);

    const afterTick = probes;
    layer.update(WIDE, 1, state, 2);
    expect(probes).toBeGreaterThan(afterTick);

    const afterEpoch = probes;
    layer.update({ ...WIDE, maxX: WIDE.maxX + 1 }, 1, state, 2);
    expect(probes).toBeGreaterThan(afterEpoch);
  });

  it('never skips while the fog probe carries no epoch', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([swayingTree()]);
    let probes = 0;
    const state = () => {
      probes++;
      return FOG_STATE.VISIBLE;
    };

    layer.update(WIDE, 0, state);
    const walked = probes;
    layer.update(WIDE, 0, state);
    expect(probes).toBeGreaterThan(walked);
  });

  it('walks when fog turns on after identical fog-off frames', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([swayingTree()]);
    let probes = 0;
    const state = () => {
      probes++;
      return FOG_STATE.EXPLORED;
    };

    layer.update(WIDE, 0);
    layer.update(WIDE, 0); // identical fog-off frame: nothing to version, skipped
    layer.update(WIDE, 0, state, 1);
    expect(probes).toBeGreaterThan(0);
  });
});
