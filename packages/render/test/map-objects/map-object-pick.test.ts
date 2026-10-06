import { Texture } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { AtlasFrame } from '../../src/data/sprites/index.js';
import { type MapObjectSprite, mapObjectBounds, mapObjectPixelHit } from '../../src/gpu/map-objects/index.js';

/**
 * `alphaMaskOf` needs a real 2d context and returns null without one, so the pixel test is exercised up
 * to its box verdict here: a point outside the frame is ground, one inside leaves the answer open.
 */

const FRAME: AtlasFrame = { x: 0, y: 0, width: 10, height: 20, offsetX: -5, offsetY: -18 };

function object(overrides: Partial<MapObjectSprite> = {}): MapObjectSprite {
  return {
    x: 100,
    y: 200,
    decor: false,
    source: Texture.WHITE.source,
    frames: [FRAME],
    scale: 1,
    phase: 0,
    ...overrides,
  };
}

describe('mapObjectBounds', () => {
  it('places the frame at the lifted feet, offset as the layer draws it', () => {
    expect(mapObjectBounds(object(), 0)).toEqual({ minX: 95, minY: 182, maxX: 105, maxY: 202 });
    expect(mapObjectBounds(object({ lift: 30 }), 0)).toEqual({ minX: 95, minY: 152, maxX: 105, maxY: 172 });
    expect(mapObjectBounds(object({ scale: 2 }), 0)).toEqual({ minX: 90, minY: 164, maxX: 110, maxY: 204 });
  });

  it('reads the pose shown at the tick and has none for an empty object', () => {
    const narrow: AtlasFrame = { ...FRAME, width: 4 };
    const looping = object({ frames: [FRAME, narrow] });
    expect(mapObjectBounds(looping, 0)?.maxX).toBe(105);
    expect(mapObjectBounds(looping, 1)?.maxX).toBe(99);
    expect(mapObjectBounds(object({ frames: [] }), 0)).toBeUndefined();
  });
});

describe('mapObjectPixelHit', () => {
  it('is ground outside the frame and open inside it when the sheet is unreadable', () => {
    const obj = object({ lift: 30 });
    expect(mapObjectPixelHit(obj, 0, 94, 160)).toBe(false);
    expect(mapObjectPixelHit(obj, 0, 100, 175)).toBe(false);
    expect(mapObjectPixelHit(obj, 0, 100, 160)).toBeUndefined();
  });
});
