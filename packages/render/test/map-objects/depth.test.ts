import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { depthKey, TILE_HALF_H } from '../../src/data/projection/index.js';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { FRAME_0, tallSprites, WIDE } from './support.js';

/**
 * The tall map-object sort row: an object normally sorts at its feet anchor, but one settlers stand ON
 * (a bridge deck) carries a `depthY` override so everything on the span paints in front of it. Its
 * shadow follows the same row, so no sprite can slip between the pair.
 */

const SHADOW_0: AtlasFrame = { x: 16, y: 0, width: 8, height: 4, offsetX: -2, offsetY: -4 };
const ANCHOR = { x: 40, y: 200 };

function tallObject(depthY?: number): MapObjectSprite {
  return {
    ...ANCHOR,
    source: Texture.WHITE.source,
    frames: [FRAME_0],
    shadow: { source: Texture.WHITE.source, frames: [SHADOW_0] },
    scale: 1,
    decor: false,
    phase: 0,
    ...(depthY !== undefined ? { depthY } : {}),
  };
}

function sortedPair(obj: MapObjectSprite): { body: number; shadow: number } {
  const spriteLayer = new Container();
  const layer = new MapObjectLayer(spriteLayer, new TextureCache());
  layer.set([obj]);
  layer.update(WIDE, 0);
  const [body, shadow] = tallSprites(spriteLayer);
  if (body === undefined || shadow === undefined) throw new Error('expected a body + shadow pair');
  return { body: body.zIndex, shadow: shadow.zIndex };
}

describe('MapObjectLayer sort row (tall objects)', () => {
  it('sorts an object at its feet anchor, with the shadow just under it', () => {
    const { body, shadow } = sortedPair(tallObject());
    expect(body).toBe(depthKey(ANCHOR.x, ANCHOR.y));
    expect(shadow).toBeLessThan(body);
  });

  it('sorts a deck object at its override row instead, shadow included', () => {
    // A deck whose far row sits three half-cell rows behind the anchor.
    const farRowY = ANCHOR.y - (3 * TILE_HALF_H) / 2;
    const { body, shadow } = sortedPair(tallObject(farRowY));
    expect(body).toBe(depthKey(ANCHOR.x, farRowY));
    expect(shadow).toBeLessThan(body);
    // Under the body but well inside its own row: the pair still cannot interleave with a sprite
    // a genuine row apart.
    expect(shadow).toBeGreaterThan(depthKey(ANCHOR.x, farRowY - 1));
  });

  it('draws a hill object at its scaled, offset, lifted feet but sorts it at the pre-lift row', () => {
    const LIFT = 24;
    const SCALE = 2;
    // Offsets and a scale that are all distinguishable, so every term of the placement is pinned.
    const OFFSET_FRAME: AtlasFrame = { x: 0, y: 0, width: 8, height: 8, offsetX: 3, offsetY: -7 };
    const spriteLayer = new Container();
    const layer = new MapObjectLayer(spriteLayer, new TextureCache());
    layer.set([{ ...tallObject(), frames: [OFFSET_FRAME], scale: SCALE, lift: LIFT }]);
    layer.update(WIDE, 0);

    const [body, shadow] = tallSprites(spriteLayer);
    expect(body?.x).toBe(ANCHOR.x + OFFSET_FRAME.offsetX * SCALE);
    expect(body?.y).toBe(ANCHOR.y - LIFT + OFFSET_FRAME.offsetY * SCALE);
    expect(shadow?.x).toBe(ANCHOR.x + SHADOW_0.offsetX * SCALE);
    expect(shadow?.y).toBe(ANCHOR.y - LIFT + SHADOW_0.offsetY * SCALE);
    // The lift is a draw offset only, so a tree baked up a hill still occludes by its map row rather
    // than jumping in front of the settler standing beside it.
    expect(body?.zIndex).toBe(depthKey(ANCHOR.x, ANCHOR.y));
  });
});
