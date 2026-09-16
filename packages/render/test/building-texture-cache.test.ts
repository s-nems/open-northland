import { Sprite, TextureSource } from 'pixi.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DrawItem } from '../src/data/scene/index.js';
import type { AtlasFrame } from '../src/data/sprites/index.js';
import { sharpenBuildingInterior } from '../src/gpu/building-texture-cache.js';
import * as drawable from '../src/gpu/drawable-resource.js';
import * as alphaMask from '../src/gpu/sprite-pool/alpha-mask.js';
import { LayerBinder } from '../src/gpu/sprite-pool/bind-layers.js';
import { pixelHit } from '../src/gpu/sprite-pool/pick.js';
import { createPooled } from '../src/gpu/sprite-pool/pooled-entity.js';
import type { ResolvedLayer } from '../src/gpu/sprite-pool/resolved-layer.js';
import { TextureCache } from '../src/gpu/texture-cache.js';

afterEach(() => vi.restoreAllMocks());

const FRAME: AtlasFrame = {
  x: 20,
  y: 30,
  width: 10,
  height: 12,
  offsetX: -5,
  offsetY: -9,
  selectionEllipse: { cx: 5, cy: 10, rx: 4, ry: 2 },
};

function mockCanvas(): ReturnType<typeof vi.fn> {
  const drawImage = vi.fn();
  vi.spyOn(drawable, 'isDrawableResource').mockReturnValue(true);
  vi.spyOn(drawable, 'readable2dContext').mockImplementation(
    (width, height) =>
      ({
        canvas: { width, height },
        drawImage,
        getImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }),
        putImageData: vi.fn(),
      }) as unknown as CanvasRenderingContext2D,
  );
  return drawImage;
}

function flatPixels(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([120, 100, 80, 255], i);
  return data;
}

function referenceSharpen(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const result = data.slice();
  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      let opaque = true;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (data[((y + dy) * width + x + dx) * 4 + 3] !== 255) opaque = false;
        }
      }
      if (!opaque) continue;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += data[((y + dy) * width + x + dx) * 4 + channel] ?? 0;
          }
        }
        const i = (y * width + x) * 4 + channel;
        const value = data[i] ?? 0;
        result[i] = value + Math.max(-8, Math.min(8, (value - sum / 9) * 0.2));
      }
    }
  }
  return result;
}

describe('building interior contrast', () => {
  it('matches the direct box-filter reference byte-for-byte on opaque and mixed-alpha gradients', () => {
    for (const [width, height] of [
      [3, 3],
      [5, 6],
      [31, 23],
      [17, 45],
    ] as const) {
      for (const mixedAlpha of [false, true]) {
        const data = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y++) {
          for (let x = 0; x < width; x++) {
            data.set(
              [
                (x * 17 + y * 9) % 256,
                (x * 3 + y * 29) % 256,
                (x * x + y * 11) % 256,
                mixedAlpha && x % 13 === 5 && y % 11 < 4 ? (y % 2 === 0 ? 0 : 128) : 255,
              ],
              (y * width + x) * 4,
            );
          }
        }
        const expected = referenceSharpen(data, width, height);
        sharpenBuildingInterior(data, width, height);
        expect(data).toEqual(expected);
      }
    }
  });

  it('leaves flat colours unchanged and bounds a native-size detail boost to eight levels', () => {
    const flat = flatPixels(9, 9);
    const before = flat.slice();
    sharpenBuildingInterior(flat, 9, 9);
    expect(flat).toEqual(before);
    const data = flatPixels(9, 9);
    const centre = (4 * 9 + 4) * 4;
    data.set([200, 20, 90], centre);
    const original = data.slice();
    sharpenBuildingInterior(data, 9, 9);
    expect(data[centre]).toBe(208);
    expect(data[centre + 1]).toBe(12);
    for (let i = 0; i < data.length; i++) {
      expect(Math.abs((data[i] ?? 0) - (original[i] ?? 0))).toBeLessThanOrEqual(8);
      if (i % 4 === 3) expect(data[i]).toBe(original[i]);
    }
  });

  it('preserves transparent pixels and the two-pixel alpha-edge neighbourhood', () => {
    const data = flatPixels(9, 9);
    for (let y = 0; y < 9; y++) {
      data[(y * 9 + 2) * 4 + 3] = y % 2 === 0 ? 0 : 128;
      data.set([200, 20, 90], (y * 9 + 4) * 4);
    }
    const original = data.slice();
    sharpenBuildingInterior(data, 9, 9);
    for (let y = 0; y < 9; y++) {
      expect(data.slice(y * 9 * 4, (y * 9 + 5) * 4)).toEqual(original.slice(y * 9 * 4, (y * 9 + 5) * 4));
    }
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(original[i]);
  });
});

describe('building frame cache', () => {
  it('isolates the atlas frame at native resolution, caches once, and releases only owned sources', () => {
    const drawImage = mockCanvas();
    const page = new TextureSource({ width: 64, height: 64, scaleMode: 'nearest' });
    const cache = new TextureCache();
    const original = cache.get(page, FRAME);
    const texture = cache.getBuilding(page, FRAME);
    expect(drawImage).toHaveBeenCalledWith(page.resource, 20, 30, 10, 12, 2, 2, 10, 12);
    expect(texture).not.toBe(original);
    expect(texture.source.autoGenerateMipmaps).toBe(true);
    expect(texture.source.scaleMode).toBe('linear');
    expect(texture.source.width).toBe(14);
    expect(texture.source.height).toBe(16);
    expect(cache.getBuilding(page, FRAME)).toBe(texture);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(page.autoGenerateMipmaps).toBe(false);
    expect(page.scaleMode).toBe('nearest');
    expect(cache.get(page, FRAME)).toBe(original);
    const sprite = new Sprite(texture);
    expect(sprite.width).toBe(10);
    expect(sprite.height).toBe(12);
    expect(sprite.visualBounds).toMatchObject({ minX: -0, minY: -0, maxX: 10, maxY: 12 });
    expect(texture.frame).toMatchObject({ x: 2, y: 2, width: 10, height: 12 });
    sprite.destroy();
    const ownedSource = texture.source;
    cache.clear();
    expect(texture.destroyed).toBe(true);
    expect(ownedSource.destroyed).toBe(true);
    expect(page.destroyed).toBe(false);
    page.destroy();
  });

  it('bypasses authored mipmapped sources, oversized frames, and unreadable resources', () => {
    const cache = new TextureCache();
    const page = new TextureSource({ width: 2048, height: 2048 });
    expect(cache.getBuilding(page, FRAME)).toBe(cache.get(page, FRAME));
    const drawImage = mockCanvas();
    const ownedPage = new TextureSource({ width: 64, height: 64, autoGenerateMipmaps: true });
    expect(cache.getBuilding(ownedPage, FRAME)).toBe(cache.get(ownedPage, FRAME));
    const suppliedMips = new TextureSource({ width: 64, height: 64, mipLevelCount: 7 });
    expect(cache.getBuilding(suppliedMips, FRAME)).toBe(cache.get(suppliedMips, FRAME));
    const oversized = { ...FRAME, width: 1100, height: 1100 };
    expect(cache.getBuilding(page, oversized)).toBe(cache.get(page, oversized));
    expect(drawImage).not.toHaveBeenCalled();
    cache.clear();
    page.destroy();
    ownedPage.destroy();
    suppliedMips.destroy();
  });

  it('caps GPU storage including the mip chain without evicting textures retained by sprites', () => {
    const drawImage = mockCanvas();
    const cache = new TextureCache();
    const page = new TextureSource({ width: 2048, height: 2048 });
    // A padded 1024-square mip chain is 5,592,404 bytes: six fit in 32 MiB, seven do not.
    const frames = Array.from({ length: 7 }, () => ({ ...FRAME, width: 1020, height: 1020 }));
    const textures = frames.map((frame) => cache.getBuilding(page, frame));
    expect(drawImage).toHaveBeenCalledTimes(6);
    expect(textures[6]?.source).toBe(page);
    expect(textures[0]?.destroyed).toBe(false);
    cache.clear();
    expect(textures[0]?.destroyed).toBe(true);
    page.destroy();
  });
});

describe('building sampling bind', () => {
  it('toggles the existing sprite back to its atlas while retaining offsets, picking bounds and selection', () => {
    mockCanvas();
    const page = new TextureSource({ width: 64, height: 64 });
    const cache = new TextureCache();
    const binder = new LayerBinder(cache, undefined);
    const pe = createPooled('building', undefined);
    const item: DrawItem = { ref: 1, kind: 'building', x: 0, y: 0, depth: 0 };
    const layer: ResolvedLayer = { source: page, frame: FRAME, scale: 2 };
    const frame = { camera: { offsetX: 0, offsetY: 0 }, screenW: 800, screenH: 600 };
    binder.bind(pe, item, [layer], { ...frame, enhancedSampling: true }, 1);
    const sprite = pe.container.children[0] as Sprite;
    expect(sprite.texture.source).not.toBe(page);
    expect(sprite.position).toMatchObject({ x: -10, y: -18 });
    expect(pe.bounds).toEqual({ minX: -10, minY: -18, maxX: 10, maxY: 6 });
    expect(pe.selectionEllipse).toEqual({ cx: 0, cy: 2, rx: 8, ry: 4 });
    const rgba = new Uint8ClampedArray(14 * 16 * 4);
    rgba[(2 * 14 + 2) * 4 + 3] = 255;
    vi.spyOn(alphaMask, 'alphaMaskOf').mockReturnValue(alphaMask.buildAlphaMask(rgba, 14, 16));
    expect(pixelHit(pe, 1, -10, -18)).toBe(true);
    expect(pixelHit(pe, 1, -8, -18)).toBe(false);
    binder.bind(pe, item, [layer], { ...frame, enhancedSampling: false }, 2);
    expect(sprite.texture).toBe(cache.get(page, FRAME));
    expect(pe.bounds).toEqual({ minX: -10, minY: -18, maxX: 10, maxY: 6 });
    pe.container.destroy({ children: true });
    cache.clear();
    page.destroy();
  });

  it('does not bake construction, upgrade, reveal, shadow or non-building layers', () => {
    const drawImage = mockCanvas();
    const page = new TextureSource({ width: 64, height: 64 });
    const cache = new TextureCache();
    const binder = new LayerBinder(cache, undefined);
    const item: DrawItem = { ref: 1, kind: 'building', x: 0, y: 0, depth: 0 };
    const layer: ResolvedLayer = { source: page, frame: FRAME, scale: 1 };
    const cases: readonly [DrawItem, ResolvedLayer][] = [
      [{ ...item, builtPct: 50 }, layer],
      [{ ...item, upgradePct: 50 }, layer],
      [item, { ...layer, reveal: 0.5 }],
      [item, { ...layer, shadow: true }],
      [{ ...item, kind: 'resource' }, layer],
    ];
    for (const [draw, resolved] of cases) {
      const pe = createPooled('building', undefined);
      binder.bind(
        pe,
        draw,
        [resolved],
        {
          camera: { offsetX: 0, offsetY: 0 },
          screenW: 800,
          screenH: 600,
          enhancedSampling: true,
        },
        1,
      );
      expect((pe.container.children[0] as Sprite).texture.source).toBe(page);
      pe.container.destroy({ children: true });
    }
    expect(drawImage).not.toHaveBeenCalled();
    cache.clear();
    page.destroy();
  });
});
