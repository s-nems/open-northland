import { FOG_STATE } from '@open-northland/sim';
import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { FOG_GHOST_TINT } from '../../src/data/fog/index.js';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { decorUVs, FRAME_0, FRAME_1, type TallSprite, tallSprites, WIDE } from './support.js';

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

function tallSprite(spriteLayer: Container): TallSprite | undefined {
  return tallSprites(spriteLayer)[0];
}

/** A two-frame animated decor object anchored at the origin, cell (0, 0). */
function wavingBush(): MapObjectSprite {
  return {
    x: 0,
    y: 0,
    source: Texture.WHITE.source,
    frames: [FRAME_0, FRAME_1],
    scale: 1,
    decor: true,
    phase: 0,
  };
}

// A ghost is a memory: a swaying tree under the fog would read as watched ground.
describe('MapObjectLayer fog gate (tall objects)', () => {
  it('hides in UNEXPLORED, draws live in VISIBLE, dims in EXPLORED', () => {
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, new TextureCache());
    layer.set([swayingTree()]);

    layer.update(WIDE, 0, () => FOG_STATE.UNEXPLORED);
    expect(tallSprite(spriteLayer)).toBeUndefined();

    layer.update(WIDE, 0, () => FOG_STATE.VISIBLE);
    expect(tallSprite(spriteLayer)?.tint).toBe(0xffffff);

    layer.update(WIDE, 0, () => FOG_STATE.EXPLORED);
    expect(tallSprite(spriteLayer)?.tint).toBe(FOG_GHOST_TINT);
  });

  it('advances the animation on VISIBLE ground but freezes it on EXPLORED ground', () => {
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, new TextureCache());
    layer.set([swayingTree()]);

    // Watched, the two-frame sway advances with the tick.
    layer.update(WIDE, 0, () => FOG_STATE.VISIBLE);
    expect(tallSprite(spriteLayer)?.frameX).toBe(FRAME_0.x);
    layer.update(WIDE, 1, () => FOG_STATE.VISIBLE);
    expect(tallSprite(spriteLayer)?.frameX).toBe(FRAME_1.x);

    // Ghosted, the pose snaps to the frozen clock and stays there across animation ticks.
    layer.update(WIDE, 2, () => FOG_STATE.EXPLORED);
    expect(tallSprite(spriteLayer)?.frameX).toBe(FRAME_0.x);
    layer.update(WIDE, 3, () => FOG_STATE.EXPLORED);
    expect(tallSprite(spriteLayer)?.frameX).toBe(FRAME_0.x);

    // Re-watched, the live clock takes over again.
    layer.update(WIDE, 5, () => FOG_STATE.VISIBLE);
    expect(tallSprite(spriteLayer)?.frameX).toBe(FRAME_1.x);
  });

  it('freezes ANIMATED DECOR (waves, grass) on unwatched ground and resumes it when re-seen', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([wavingBush()]);

    // Watched, the quad's UVs swap frames with the tick.
    layer.update(WIDE, 0, () => FOG_STATE.VISIBLE);
    const frame0UVs = [...decorUVs(layer)];
    layer.update(WIDE, 1, () => FOG_STATE.VISIBLE);
    expect([...decorUVs(layer)]).not.toEqual(frame0UVs);

    // Ghosted, frozen at the fixed clock across animation ticks.
    layer.update(WIDE, 2, () => FOG_STATE.EXPLORED);
    expect([...decorUVs(layer)]).toEqual(frame0UVs);
    layer.update(WIDE, 3, () => FOG_STATE.EXPLORED);
    expect([...decorUVs(layer)]).toEqual(frame0UVs);

    // Re-watched, the sway resumes on the live clock.
    layer.update(WIDE, 5, () => FOG_STATE.VISIBLE);
    expect([...decorUVs(layer)]).not.toEqual(frame0UVs);
  });
});
