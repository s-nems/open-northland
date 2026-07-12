import { FOG_STATE } from '@vinland/sim';
import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { FOG_GHOST_TINT } from '../src/data/fog.js';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import type { Viewport } from '../src/data/viewport.js';
import { MapObjectLayer, type MapObjectSprite } from '../src/gpu/map-objects/index.js';
import { TextureCache } from '../src/gpu/texture-cache.js';

/**
 * The tall map-object FOG gate ({@link MapObjectLayer.update}'s `fogStateOfCell`): a virgin
 * tree/stone hides in the UNEXPLORED black, draws live on VISIBLE ground, and on EXPLORED ground
 * becomes its own ghost — dimmed to the explored grading AND frozen mid-animation (a ghost is a
 * memory; swaying trees under the fog would read as watched ground). Headless like the removal
 * tests — display objects construct without a GL context.
 */

const FRAME_0: AtlasFrame = { x: 0, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };
const FRAME_1: AtlasFrame = { x: 8, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };

const WIDE: Viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

/** A two-frame TALL object (an animated tree) anchored at the origin — cell (0, 0). */
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

/** The one attached tall sprite, or undefined while hidden. */
function tallSprite(spriteLayer: Container): { tint: number; frameX: number } | undefined {
  const spr = spriteLayer.children[0] as { tint: number; texture: Texture } | undefined;
  return spr === undefined ? undefined : { tint: spr.tint, frameX: spr.texture.frame.x };
}

/** A two-frame animated DECOR object (a wave / swaying bush) anchored at the origin — cell (0, 0). */
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

/** The animated decor batch's UV buffer — the frame pick is observable as the quad's atlas UVs. */
function decorUVs(layer: MapObjectLayer): Float32Array {
  const mesh = layer.decorContainer.children[0]?.children[0] as { geometry?: { uvs: Float32Array } };
  const uvs = mesh?.geometry?.uvs;
  if (uvs === undefined) throw new Error('expected one decor batch mesh');
  return uvs;
}

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

    // Watched: the two-frame sway advances with the tick.
    layer.update(WIDE, 0, () => FOG_STATE.VISIBLE);
    expect(tallSprite(spriteLayer)?.frameX).toBe(FRAME_0.x);
    layer.update(WIDE, 1, () => FOG_STATE.VISIBLE);
    expect(tallSprite(spriteLayer)?.frameX).toBe(FRAME_1.x);

    // Ghosted: the pose snaps to the frozen clock and STAYS there across animation ticks.
    layer.update(WIDE, 2, () => FOG_STATE.EXPLORED);
    expect(tallSprite(spriteLayer)?.frameX).toBe(FRAME_0.x);
    layer.update(WIDE, 3, () => FOG_STATE.EXPLORED);
    expect(tallSprite(spriteLayer)?.frameX).toBe(FRAME_0.x);

    // Re-watched: the live clock takes over again (tick 5 → frame 1).
    layer.update(WIDE, 5, () => FOG_STATE.VISIBLE);
    expect(tallSprite(spriteLayer)?.frameX).toBe(FRAME_1.x);
  });

  it('freezes ANIMATED DECOR (waves, grass) on unwatched ground and resumes it when re-seen', () => {
    const layer = new MapObjectLayer(new Container(), new TextureCache());
    layer.set([wavingBush()]);

    // Watched: the quad's UVs swap frames with the tick.
    layer.update(WIDE, 0, () => FOG_STATE.VISIBLE);
    const frame0UVs = [...decorUVs(layer)];
    layer.update(WIDE, 1, () => FOG_STATE.VISIBLE);
    expect([...decorUVs(layer)]).not.toEqual(frame0UVs);

    // Ghosted (explored-only): frozen at the fixed clock — frame 0 — across animation ticks.
    layer.update(WIDE, 2, () => FOG_STATE.EXPLORED);
    expect([...decorUVs(layer)]).toEqual(frame0UVs);
    layer.update(WIDE, 3, () => FOG_STATE.EXPLORED);
    expect([...decorUVs(layer)]).toEqual(frame0UVs);

    // Re-watched: the sway resumes on the live clock (tick 5 → frame 1).
    layer.update(WIDE, 5, () => FOG_STATE.VISIBLE);
    expect([...decorUVs(layer)]).not.toEqual(frame0UVs);
  });
});
