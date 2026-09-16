import { Sprite, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import * as drawable from '../src/gpu/drawable-resource.js';
import { softenShadowAlpha } from '../src/gpu/soft-shadow-cache.js';
import { TextureCache } from '../src/gpu/texture-cache.js';

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
