import { Container, Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { depthKey } from '../../src/data/projection/index.js';
import { drawPassDepth, screenDepth } from '../../src/data/scene/index.js';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import { MapObjectLayer, type MapObjectSprite } from '../../src/gpu/map-objects/index.js';
import { TextureCache } from '../../src/gpu/texture-cache.js';
import { FRAME_0, tallSprites, WIDE } from './support.js';

/**
 * A tall map object sorts at its feet anchor, except a still one: it draws in the ground pass, under
 * every entity whatever its row, so whoever stands on a bridge deck paints over it.
 */

const SHADOW_0: AtlasFrame = { x: 16, y: 0, width: 8, height: 4, offsetX: -2, offsetY: -4 };
const ANCHOR = { x: 40, y: 200 };

function tallObject(groundPass = false): MapObjectSprite {
  return {
    ...ANCHOR,
    source: Texture.WHITE.source,
    frames: [FRAME_0],
    shadow: { source: Texture.WHITE.source, frames: [SHADOW_0] },
    scale: 1,
    decor: false,
    phase: 0,
    ...(groundPass ? { groundPass } : {}),
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

  it('files a still object under an entity on any row, shadow included, keeping its own row order', () => {
    const { body, shadow } = sortedPair(tallObject(true));
    expect(body).toBe(depthKey(ANCHOR.x, ANCHOR.y) + drawPassDepth('ground'));
    expect(shadow).toBeLessThan(body);
    // A settler far up the map, on the deck's far end, still paints over it.
    expect(body).toBeLessThan(screenDepth(ANCHOR.x, 0, 'settler'));
    // Two still objects keep their row order among themselves.
    expect(body).toBeGreaterThan(depthKey(ANCHOR.x, ANCHOR.y - 1) + drawPassDepth('ground'));
  });

  it('draws a hill object at its scaled, offset, lifted feet but sorts it at the pre-lift row', () => {
    const LIFT = 24;
    const SCALE = 2;
    // Distinguishable offsets and scale, so every term of the placement is pinned.
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
    // The lift is a draw offset only, so a tree up a hill still occludes by its map row rather than
    // jumping in front of the settler beside it.
    expect(body?.zIndex).toBe(depthKey(ANCHOR.x, ANCHOR.y));
  });
});
