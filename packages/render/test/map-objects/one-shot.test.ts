import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { objectFrameIndexAt } from '../../src/gpu/map-objects/map-object-sprite.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { decorUVs, FRAME_0, FRAME_1, tallSprites, WIDE } from './support.js';

/** The third clip frame and the resting still, told apart from the clip's by their atlas `x`. */
const FRAME_2: AtlasFrame = { ...FRAME_0, x: 16 };
const REST_FRAME: AtlasFrame = { ...FRAME_0, x: 64 };
const CLIP_FRAMES = [FRAME_0, FRAME_1, FRAME_2];
const START = 10;
/** The first tick after the clip's three frames. */
const END = START + CLIP_FRAMES.length;

function still(decor: boolean): MapObjectSprite {
  return { x: 0, y: 0, decor, source: Texture.WHITE.source, frames: [REST_FRAME], scale: 1, phase: 0 };
}

function clip(decor: boolean, rest: MapObjectSprite | null): MapObjectSprite {
  return {
    x: 0,
    y: 0,
    decor,
    source: Texture.WHITE.source,
    frames: CLIP_FRAMES,
    scale: 1,
    phase: 5,
    once: { from: START, rest },
  };
}

describe('one-shot map-object clips', () => {
  it('play each frame for one tick from their start and hold the ends, ignoring the loop phase', () => {
    const obj = clip(false, null);
    const frames = [START - 1, START, START + 1, START + 2, END + 4].map((t) => objectFrameIndexAt(obj, t));
    expect(frames).toEqual([0, 0, 1, 2, 2]);
  });

  it('a tall clip plays, then gives way to its resting still on its end tick', () => {
    const sprites = new Container();
    const layer = new MapObjectLayer(sprites, new TextureCache());
    layer.set([clip(false, still(false))]);
    layer.update(WIDE, START + 1);
    expect(tallSprites(sprites).map((s) => s.frameX)).toEqual([FRAME_1.x]);
    layer.update(WIDE, END - 1);
    expect(tallSprites(sprites).map((s) => s.frameX)).toEqual([FRAME_2.x]);
    layer.update(WIDE, END);
    expect(tallSprites(sprites).map((s) => s.frameX)).toEqual([REST_FRAME.x]);
    layer.destroy();
  });

  it('removing the placed clip removes the still that replaced it', () => {
    const sprites = new Container();
    const layer = new MapObjectLayer(sprites, new TextureCache());
    const placed = clip(false, still(false));
    layer.set([placed]);
    layer.update(WIDE, END);
    layer.remove(placed);
    layer.update(WIDE, END + 1);
    expect(sprites.children).toHaveLength(0);
    layer.destroy();
  });

  it('a clip with no still retires on its end tick, and one removed mid-play never returns', () => {
    const sprites = new Container();
    const layer = new MapObjectLayer(sprites, new TextureCache());
    const retiring = clip(false, null);
    const removed = { ...clip(false, still(false)), x: 50 };
    layer.set([retiring, removed]);
    layer.update(WIDE, START);
    expect(sprites.children).toHaveLength(2);
    layer.remove(removed);
    layer.update(WIDE, END);
    expect(sprites.children).toHaveLength(0);
    layer.destroy();
  });

  it('a decor clip rewrites its quad per tick, then rests in a rebuilt batch', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([clip(true, still(true))]);
    // The page is 1 px wide (Texture.WHITE), so a quad's first U is its frame's atlas x.
    layer.update(WIDE, START + 1);
    expect(decorUVs(layer)[0]).toBe(FRAME_1.x);
    layer.update(WIDE, END);
    expect(decorUVs(layer)[0]).toBe(REST_FRAME.x);
    layer.destroy();
  });
});
