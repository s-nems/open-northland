import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { FRAME_0, FRAME_1, tallSprites, WIDE } from './support.js';

/**
 * The tall map-object cast shadow: a tall object whose sprite carries a shadow twin attaches a second
 * sprite sorted just under the body (the original blits a shadow immediately before its caster), binds
 * the shadow at the SAME pose index as the body, and hides it for a pose without a silhouette.
 * Headless like the fog tests — display objects construct without a GL context.
 */

const SHADOW_0: AtlasFrame = { x: 16, y: 0, width: 8, height: 4, offsetX: -2, offsetY: -4 };

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

describe('MapObjectLayer cast shadows (tall objects)', () => {
  it('attaches a shadow sprite sorted below the body and binds the same pose index', () => {
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, new TextureCache());
    layer.set([shadowedTree()]);

    layer.update(WIDE, 0);
    const [body, shadow] = tallSprites(spriteLayer);
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
    expect(tallSprites(spriteLayer)[1]?.visible).toBe(false);

    layer.update(WIDE, 2); // pose 0 again
    const shadow = tallSprites(spriteLayer)[1];
    expect(shadow?.visible).toBe(true);
    expect(shadow?.frameX).toBe(SHADOW_0.x);
  });

  it('mints no shadow sprite for an object without a shadow twin', () => {
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, new TextureCache());
    const { shadow: _shadow, ...bare } = shadowedTree();
    layer.set([bare]);

    layer.update(WIDE, 0);
    expect(spriteLayer.children.length).toBe(1);
  });
});
