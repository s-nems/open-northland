import { GfxPattern, TerrainPattern } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../src/decoders/image.js';
import { decodePng } from '../src/decoders/png.js';
import { createMinimapSynthesizer } from '../src/stages/maps/index.js';

/** A 2×2 page of one solid colour. */
function solidPage(r: number, g: number, b: number): RgbaImage {
  const rgba = new Uint8Array(2 * 2 * 4);
  for (let i = 0; i < 4; i++) rgba.set([r, g, b, 255], i * 4);
  return { width: 2, height: 2, rgba };
}

const WATER = GfxPattern.parse({
  id: 0,
  editName: 'water 01',
  texture: 'data/engine2d/bin/textures/text_007.pcx',
  coordsA: [0, 0, 2, 0, 0, 2],
  coordsB: [2, 0, 2, 2, 0, 2],
  logicType: 1,
});

const LAND_TYPE = TerrainPattern.parse({
  typeId: 2,
  family: 'land',
  patternId: 0,
  logicType: 2,
  texture: 'data/engine2d/bin/textures/text_001.pcx',
  coordsA: [0, 0, 2, 0, 0, 2],
  coordsB: [2, 0, 2, 2, 0, 2],
  debugColor: [10, 200, 30],
});

const GRID = { width: 2, height: 2, typeIds: [2, 2, 2, 2] };

describe('createMinimapSynthesizer', () => {
  it('rasterizes the ground lanes with the pattern mean colour, capped to the preview box', async () => {
    const synthesize = createMinimapSynthesizer({
      gfxPatterns: [WATER],
      terrainPatterns: [],
      readPage: async (key) => (key === 'text_007' ? solidPage(0, 0, 255) : null),
    });
    const png = await synthesize({
      ...GRID,
      ground: { patterns: ['water 01'], a: [0, 0, 0, 0], b: [0, 0, 0, 0] },
    });
    if (png === undefined) throw new Error('expected a synthesized PNG');
    const image = decodePng(png);
    // 2×2 world bounds are 170×114 px; the 720×420 cap scales by 420/114.
    expect(image.height).toBe(420);
    expect(image.width).toBe(Math.round(170 * (420 / 114)));
    let offColour = 0;
    for (let i = 0; i < image.width * image.height; i++) {
      if (image.rgba[i * 4 + 2] !== 255 || image.rgba[i * 4 + 3] !== 255) offColour++;
    }
    expect(offColour).toBe(0);
  });

  it('falls back to the typeId debugColor for lanes that resolve no pattern', async () => {
    const synthesize = createMinimapSynthesizer({
      gfxPatterns: [WATER],
      terrainPatterns: [LAND_TYPE],
      readPage: async (key) => (key === 'text_007' ? solidPage(0, 0, 255) : null),
    });
    const png = await synthesize({
      ...GRID,
      // One lane resolves (the synthesizer emits), the other three fall to typeId 2's debugColor.
      ground: { patterns: ['water 01', 'missing'], a: [0, 1, 1, 1], b: [0, 1, 1, 1] },
    });
    if (png === undefined) throw new Error('expected a synthesized PNG');
    const image = decodePng(png);
    const seen = new Set<number>();
    for (let i = 0; i < image.width * image.height; i++) {
      seen.add(
        ((image.rgba[i * 4] ?? 0) << 16) | ((image.rgba[i * 4 + 1] ?? 0) << 8) | (image.rgba[i * 4 + 2] ?? 0),
      );
    }
    expect(seen.has(0x0000ff)).toBe(true);
    expect(seen.has((10 << 16) | (200 << 8) | 30)).toBe(true);
  });

  it('yields nothing without ground lanes or when no lane pattern resolves a colour', async () => {
    const synthesize = createMinimapSynthesizer({
      gfxPatterns: [WATER],
      terrainPatterns: [LAND_TYPE],
      readPage: async () => null,
    });
    expect(await synthesize(GRID)).toBeUndefined();
    expect(
      await synthesize({ ...GRID, ground: { patterns: ['water 01'], a: [0, 0, 0, 0], b: [0, 0, 0, 0] } }),
    ).toBeUndefined();
  });
});
