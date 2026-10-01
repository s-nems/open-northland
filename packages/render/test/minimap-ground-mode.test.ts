import { describe, expect, it } from 'vitest';
import {
  applyMinimapGroundMode,
  MINIMAP_GROUND_MODES,
  type MinimapGroundMode,
} from '../src/data/terrain/minimap-ground-mode.js';

const GRASS = [74, 118, 50] as const;
const WATER = [38, 84, 132] as const;
/** The raster's shallow water: nearly as green as blue. */
const SHALLOW = [58, 156, 164] as const;
const SAND = [200, 168, 110] as const;
/** A partly transparent pixel, so the alpha check sees more than the opaque raster's 255. */
const SEMI_ALPHA = 77;

function raster(...pixels: readonly (readonly [number, number, number])[]): Uint8Array {
  return new Uint8Array(pixels.flatMap(([r, g, b], i) => [r, g, b, i === 0 ? SEMI_ALPHA : 255]));
}

function pixel(rgba: Uint8Array, index: number): [number, number, number, number] {
  const at = index * 4;
  return [rgba[at] ?? 0, rgba[at + 1] ?? 0, rgba[at + 2] ?? 0, rgba[at + 3] ?? 0];
}

/** HSV saturation and value, 0..1. */
function saturationAndValue(rgba: Uint8Array, index: number): { saturation: number; value: number } {
  const [r, g, b] = pixel(rgba, index);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return { saturation: max === 0 ? 0 : (max - min) / max, value: max / 255 };
}

/** Byte chroma: the spread between the strongest and weakest channel. */
function chroma(rgba: Uint8Array, index: number): number {
  const [r, g, b] = pixel(rgba, index);
  return Math.max(r, g, b) - Math.min(r, g, b);
}

const graded = (mode: MinimapGroundMode, source: Uint8Array): Uint8Array =>
  applyMinimapGroundMode(source, mode, new Uint8Array(source.length));

describe('minimap ground mode', () => {
  it('leaves the natural raster as it is, in place or copied', () => {
    const source = raster(GRASS, WATER, SAND);
    const before = source.slice();
    expect(applyMinimapGroundMode(source, 'natural')).toBe(source);
    expect(source).toEqual(before);
    expect(graded('natural', source)).toEqual(before);
  });

  it('lowers saturation and value from natural through muted to dark', () => {
    const source = raster(GRASS, WATER, SAND);
    const looks = (['natural', 'muted', 'dark'] as const).map((mode) => graded(mode, source));
    for (let index = 0; index < 3; index++) {
      const [natural, muted, dark] = looks.map((rgba) => saturationAndValue(rgba, index));
      expect(muted?.saturation).toBeLessThan(natural?.saturation ?? 0);
      expect(dark?.saturation).toBeLessThan(muted?.saturation ?? 0);
      expect(muted?.value).toBeLessThan(natural?.value ?? 0);
      expect(dark?.value).toBeLessThan(muted?.value ?? 0);
    }
  });

  it('keeps every alpha and is deterministic', () => {
    const source = raster(GRASS, WATER, SAND);
    for (const mode of MINIMAP_GROUND_MODES) {
      const out = graded(mode, source);
      expect([0, 1, 2].map((index) => pixel(out, index)[3])).toEqual([SEMI_ALPHA, 255, 255]);
      expect(graded(mode, source)).toEqual(out);
      expect(applyMinimapGroundMode(source.slice(), mode)).toEqual(out);
    }
  });

  it('keeps water, shallows included, bluer than grass in the dark look', () => {
    const out = graded('dark', raster(GRASS, WATER, SHALLOW, SAND));
    const blueness = (index: number): number => {
      const [r, g, b] = pixel(out, index);
      return b - Math.max(r, g);
    };
    expect(blueness(1)).toBeGreaterThan(0);
    expect(blueness(1)).toBeGreaterThan(blueness(0));
    expect(blueness(2)).toBeGreaterThan(blueness(0));
    // Land keeps the land saturation: the shallows keep more of their chroma than sand of its own.
    expect(chroma(out, 2)).toBeGreaterThan(chroma(out, 3));
  });

  it('draws one flat colour with no ground', () => {
    const out = graded('hidden', raster(GRASS, WATER, SAND));
    expect(pixel(out, 1)).toEqual(pixel(out, 2));
    expect(pixel(out, 0).slice(0, 3)).toEqual(pixel(out, 1).slice(0, 3));
  });

  it('refuses a target of another size', () => {
    expect(() => applyMinimapGroundMode(raster(GRASS), 'dark', new Uint8Array(8))).toThrow();
  });
});
