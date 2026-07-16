import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import type { Viewport } from '../src/data/viewport.js';
import { MapObjectLayer, type MapObjectSprite } from '../src/gpu/map-objects/index.js';
import { TextureCache } from '../src/gpu/texture-cache.js';

/**
 * The tall map-object cast shadow: a tall object whose sprite carries a shadow twin attaches a second
 * sprite sorted just under the body (the original blits a shadow immediately before its caster), binds
 * the shadow at the SAME pose index as the body, and hides it for a pose without a silhouette.
 * Headless like the fog tests — display objects construct without a GL context.
 */

const FRAME_0: AtlasFrame = { x: 0, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };
const FRAME_1: AtlasFrame = { x: 8, y: 0, width: 8, height: 8, offsetX: 0, offsetY: 0 };
const SHADOW_0: AtlasFrame = { x: 16, y: 0, width: 8, height: 4, offsetX: -2, offsetY: -4 };

const WIDE: Viewport = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

/** A two-frame animated tall tree whose first pose casts a shadow and second does not. */
function shadowedTree(): MapObjectSprite {
  return {
    x: 0,
    y: 0,
    source: Texture.WHITE.source,
    frames: [FRAME_0, FRAME_1],
    shadow: { source: Texture.WHITE.source, frames: [SHADOW_0, undefined] },
    scale: 1,
    decor: false,
    phase: 0,
  };
}

/** The attached sprites, in child order, as `{ zIndex, frameX, visible }`. */
function attached(spriteLayer: Container): { zIndex: number; frameX: number; visible: boolean }[] {
  return spriteLayer.children.map((c) => {
    const spr = c as unknown as { zIndex: number; texture: Texture; visible: boolean };
    return { zIndex: spr.zIndex, frameX: spr.texture.frame.x, visible: spr.visible };
  });
}

describe('TallObjectLayer cast shadows', () => {
  it('attaches a shadow sprite sorted below the body and binds the same pose index', () => {
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, new TextureCache());
    layer.set([shadowedTree()]);

    layer.update(WIDE, 0);
    const [body, shadow] = attached(spriteLayer);
    expect(body?.frameX).toBe(FRAME_0.x);
    expect(shadow?.frameX).toBe(SHADOW_0.x);
    expect(shadow?.visible).toBe(true);
    expect(shadow !== undefined && body !== undefined && shadow.zIndex < body.zIndex).toBe(true);
  });

  it('hides the shadow for a pose without a silhouette and rebinds it when the pose returns', () => {
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, new TextureCache());
    layer.set([shadowedTree()]);

    layer.update(WIDE, 1); // pose 1 — no silhouette
    expect(attached(spriteLayer)[1]?.visible).toBe(false);

    layer.update(WIDE, 2); // pose 0 again
    const shadow = attached(spriteLayer)[1];
    expect(shadow?.visible).toBe(true);
    expect(shadow?.frameX).toBe(SHADOW_0.x);
  });

  it('mints no shadow sprite for an object without a shadow twin', () => {
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, new TextureCache());
    const bare: MapObjectSprite = { ...shadowedTree(), shadow: undefined };
    layer.set([bare]);

    layer.update(WIDE, 0);
    expect(spriteLayer.children.length).toBe(1);
  });
});
