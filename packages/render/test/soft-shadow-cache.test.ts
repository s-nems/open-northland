import { Container, Sprite, type Texture, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import * as drawable from '../src/gpu/drawable-resource.js';
import { MapObjectLayer, type MapObjectSprite } from '../src/gpu/map-objects/index.js';
import { softenShadowAlpha } from '../src/gpu/soft-shadow-cache.js';
import { TextureCache } from '../src/gpu/texture-cache.js';
import { WIDE } from './map-objects/support.js';

/** A bake needs a drawable page and a readable 2d context; neither exists headless. */
function stubBakeSurface(): void {
  const ctx = {
    canvas: { width: 16, height: 16 },
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray(16 * 16 * 4) }),
    putImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(drawable, 'isDrawableResource').mockReturnValue(true);
  vi.spyOn(drawable, 'readable2dContext').mockReturnValue(ctx);
}

afterEach(() => vi.restoreAllMocks());

describe('soft shadows', () => {
  it('softens silhouette edges while preserving interior opacity and transparent padding', () => {
    const width = 15;
    const data = new Uint8ClampedArray(width * width * 4);
    for (let y = 3; y < 12; y++) {
      for (let x = 3; x < 12; x++) data[(y * width + x) * 4 + 3] = 80;
    }
    softenShadowAlpha(data, width, width);
    const alpha = (x: number, y: number): number => data[(y * width + x) * 4 + 3] ?? 0;
    expect(alpha(7, 7)).toBe(80);
    expect(alpha(2, 7)).toBeGreaterThan(0);
    expect(alpha(3, 7)).toBeLessThan(80);
    expect(alpha(0, 7)).toBe(0);
    for (let y = 0; y < width; y++) {
      for (let x = 0; x < width; x++) {
        expect(alpha(x, y)).toBe(alpha(width - 1 - x, y));
        expect(alpha(x, y)).toBeLessThanOrEqual(80);
      }
    }
  });

  it('keeps original offsets through padding, restores baseline, and releases owned sources', () => {
    const frame: AtlasFrame = {
      x: 20,
      y: 30,
      width: 10,
      height: 12,
      offsetX: -5,
      offsetY: -9,
    };
    const page = new TextureSource({ width: 64, height: 64 });
    const image = { data: new Uint8ClampedArray(16 * 18 * 4) };
    const drawImage = vi.fn();
    const ctx = {
      canvas: { width: 16, height: 18 },
      drawImage,
      getImageData: () => image,
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(drawable, 'isDrawableResource').mockReturnValue(true);
    vi.spyOn(drawable, 'readable2dContext').mockReturnValue(ctx);
    const cache = new TextureCache();
    const original = cache.getShadow(page, frame);
    cache.setSoftShadows(true);
    const soft = cache.getShadow(page, frame);
    expect(drawImage).toHaveBeenCalledWith(page.resource, 20, 30, 10, 12, 3, 3, 10, 12);
    expect(soft).not.toBe(original);
    expect(cache.getShadow(page, frame)).toBe(soft);
    const sprite = new Sprite(soft);
    expect(sprite.width).toBe(10);
    expect(sprite.height).toBe(12);
    expect(sprite.visualBounds).toMatchObject({
      minX: -3,
      minY: -3,
      maxX: 13,
      maxY: 15,
    });
    cache.setSoftShadows(false);
    expect(cache.getShadow(page, frame)).toBe(original);
    sprite.destroy();
    const ownedSource = soft.source;
    cache.clear();
    expect(soft.destroyed).toBe(true);
    expect(ownedSource.destroyed).toBe(true);
    expect(page.destroyed).toBe(false);
    page.destroy();
  });

  it('re-softens an already attached still object when the setting goes on mid-session', () => {
    stubBakeSurface();
    const frame: AtlasFrame = { x: 0, y: 0, width: 8, height: 8, offsetX: -4, offsetY: -7 };
    // A distinct frame object per page: the cache keys on frame identity and owns that 1:1 invariant.
    const shadowFrame: AtlasFrame = { ...frame };
    const page = new TextureSource({ width: 64, height: 64 });
    const shadowPage = new TextureSource({ width: 64, height: 64 });
    // One frame and no sway: nothing about this object changes between ticks, so only the revision
    // the cache bumps can bring it back for a fresh shadow bind.
    const still: MapObjectSprite = {
      x: 20,
      y: 40,
      source: page,
      frames: [frame],
      scale: 1,
      decor: false,
      phase: 0,
      shadow: { source: shadowPage, frames: [shadowFrame] },
    };
    const spriteLayer = new Container();
    const cache = new TextureCache();
    const layer = new MapObjectLayer(spriteLayer, cache);
    layer.set([still]);
    layer.update(WIDE, 20);
    const shadowOf = (): Texture | undefined =>
      spriteLayer.children
        .map((child) => (child as unknown as { texture?: Texture }).texture)
        .find((texture) => texture?.source === shadowPage);
    const hard = shadowOf();
    expect(hard).toBeDefined();

    cache.setSoftShadows(true);
    layer.update(WIDE, 20); // same viewport, same tick: only the revision may force the rebind
    // The bake owns a fresh canvas page, so the shadow sprite must now hold neither original page.
    const rebound = spriteLayer.children
      .map((child) => (child as unknown as { texture?: Texture }).texture)
      .find((texture) => texture !== undefined && texture.source !== page);
    expect(rebound).toBeDefined();
    expect(rebound).not.toBe(hard);
    expect(rebound?.source).not.toBe(shadowPage);

    layer.destroy();
    cache.clear();
    page.destroy();
    shadowPage.destroy();
  });

  it('falls back to the original when pixels are unavailable or a frame is too large', () => {
    const cache = new TextureCache();
    cache.setSoftShadows(true);
    const page = new TextureSource({ width: 1024, height: 1024 });
    for (const width of [16, 1024]) {
      const frame: AtlasFrame = {
        x: 0,
        y: 0,
        width,
        height: width,
        offsetX: 0,
        offsetY: 0,
      };
      expect(cache.getShadow(page, frame)).toBe(cache.get(page, frame));
    }
    cache.clear();
    page.destroy();
  });
});
