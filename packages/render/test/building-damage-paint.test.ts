import { describe, expect, it } from 'vitest';
import { DamagePaintCache, type DamageRaster } from '../src/gpu/building-damage/paint-cache.js';
import { analyseSurface, scarSurface } from '../src/gpu/building-damage/surface.js';

function raster(seed: number, width = 48): DamageRaster {
  const height = 64;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const backing = pixels.slice();
  for (let y = 4; y < height - 4; y++)
    for (let x = 4; x < width - 4; x++) {
      const at = (y * width + x) * 4;
      pixels.set([150 + (x % 7), 112, 73 + (y % 5), y === 4 ? 160 : 255], at);
      if (x % 9 < 3) backing.set([65, 43, 28, 255], at);
    }
  return { pixels, backing, width, height, fractures: analyseSurface(pixels, width, height, seed) };
}

describe('building damage endpoint cache', () => {
  it('matches independent bakes while damage and repair cross every blend interval', () => {
    const surface = raster(73);
    const pristine = surface.pixels.slice();
    const cache = new DamagePaintCache();
    for (const direction of [1, -1]) {
      for (let step = 0; step <= 96; step++) {
        const level = direction > 0 ? step / 16 : 6 - step / 16;
        expect(cache.paint(surface, level)).toEqual(
          scarSurface(
            surface.pixels,
            surface.width,
            surface.height,
            surface.fractures,
            level,
            surface.backing,
          ),
        );
      }
    }
    expect(surface.pixels).toEqual(pristine);
    expect(cache.stats.endpointPaints).toBeLessThan(20);
  });

  it('reuses endpoints across repeated hits without modifying an earlier blend', () => {
    const surface = raster(19);
    const cache = new DamagePaintCache();
    const before = cache.paint(surface, 4.125);
    const copy = before.slice();
    for (const level of [4.25, 4.5, 4.9375, 4.5]) cache.paint(surface, level);
    expect(cache.stats.endpointPaints).toBe(2);
    expect(before).toEqual(copy);
    expect(cache.paint(surface, 4.125)).toEqual(copy);
  });

  it('evicts old pairs within its byte budget and releases retired sources', () => {
    const a = raster(1),
      b = raster(2),
      c = raster(3);
    const pairBytes = a.pixels.byteLength * 2;
    const cache = new DamagePaintCache(pairBytes * 2);
    cache.paint(a, 2.5);
    cache.paint(b, 2.5);
    cache.paint(a, 2.75);
    cache.paint(c, 2.5);
    expect(cache.retainedBytes).toBe(pairBytes * 2);
    expect(cache.stats.evictions).toBe(1);
    const painted = cache.stats.endpointPaints;
    cache.paint(a, 2.875);
    expect(cache.stats.endpointPaints).toBe(painted);
    cache.paint(b, 2.5);
    expect(cache.stats.endpointPaints).toBe(painted + 2);
    for (const surface of [a, b, c]) cache.forget(surface);
    expect(cache.retainedBytes).toBe(0);
  });

  it('still paints correctly when a pair exceeds the cache budget', () => {
    const surface = raster(8);
    const cache = new DamagePaintCache(1);
    const first = cache.paint(surface, 5.5);
    expect(cache.paint(surface, 5.5)).toEqual(first);
    expect(cache.retainedBytes).toBe(0);
  });
});
