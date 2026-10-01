import { GatheringPipeline, GfxPattern, LandscapeGfx, TerrainPattern } from '@open-northland/data';
import {
  mapPreviewSize,
  minimapObjectLanes,
  minimapScene,
  rasterizeMinimap,
} from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import type { RgbaImage } from '../src/decoders/image.js';
import { decodePng } from '../src/decoders/png.js';
import { createMinimapSynthesizer, minimapFeatureByEditName } from '../src/stages/maps/index.js';

const BLUE = 0x0000ff;
const DEBUG_GREEN = (10 << 16) | (200 << 8) | 30;
const OPAQUE = 255;

/** A 2×2 page of one solid colour. */
function solidPage(r: number, g: number, b: number): RgbaImage {
  const rgba = new Uint8Array(2 * 2 * 4);
  for (let i = 0; i < 4; i++) rgba.set([r, g, b, OPAQUE], i * 4);
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

const MEADOW = GfxPattern.parse({
  id: 1,
  editName: 'meadow 01',
  texture: 'data/engine2d/bin/textures/text_001.pcx',
  coordsA: [0, 0, 2, 0, 0, 2],
  coordsB: [2, 0, 2, 2, 0, 2],
  logicType: 2,
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

const YEW = LandscapeGfx.parse({ index: 290, editName: 'yew 01', logicType: 4 });
const IRON_MINE = LandscapeGfx.parse({ index: 822, editName: 'iron mine 01', logicType: 18 });
const BOULDER = LandscapeGfx.parse({ index: 900, editName: 'boulder decor 01', logicType: 30 });
const HARVEST = {
  landscapeGfx: [YEW, IRON_MINE, BOULDER],
  gatheringPipeline: [
    GatheringPipeline.parse({
      goodType: 5,
      goodId: 'wood',
      harvest: { landscapeType: 4, gfxIndices: [290] },
    }),
    GatheringPipeline.parse({
      goodType: 6,
      goodId: 'iron',
      harvest: { landscapeType: 18, gfxIndices: [822] },
    }),
  ],
};
const NO_HARVEST = { landscapeGfx: [], gatheringPipeline: [] };

const SIZE = 6;
const CELLS = SIZE * SIZE;
const GRID = { width: SIZE, height: SIZE, typeIds: new Array<number>(CELLS).fill(2) };
const MEADOW_GROUND = {
  patterns: ['meadow 01'],
  a: new Array<number>(CELLS).fill(0),
  b: new Array<number>(CELLS).fill(0),
};

async function synthesized(png: Uint8Array | undefined): Promise<RgbaImage> {
  if (png === undefined) throw new Error('expected a synthesized PNG');
  return decodePng(png);
}

describe('minimapFeatureByEditName', () => {
  it('draws a tree as forest and an ore mine as its ore through the harvest join, and decor as nothing', () => {
    const featureOf = minimapFeatureByEditName(HARVEST);
    expect(featureOf('yew 01')).toBe('forest');
    expect(featureOf('iron mine 01')).toBe('iron');
    expect(featureOf('boulder decor 01')).toBeUndefined();
    expect(featureOf('no such object')).toBeUndefined();
  });
});

describe('createMinimapSynthesizer', () => {
  it('draws the styled minimap of the ground lanes in the preview box', async () => {
    const synthesize = createMinimapSynthesizer({
      gfxPatterns: [WATER],
      terrainPatterns: [],
      readPage: async (key) => (key === 'text_007' ? solidPage(0, 0, 255) : null),
      ...NO_HARVEST,
    });
    const ground = {
      patterns: ['water 01'],
      a: new Array<number>(CELLS).fill(0),
      b: new Array<number>(CELLS).fill(0),
    };
    const image = await synthesized(await synthesize({ ...GRID, ground }));
    const size = mapPreviewSize(SIZE, SIZE);
    expect([image.width, image.height]).toEqual([size.width, size.height]);
    const expected = rasterizeMinimap(
      minimapScene({ ...GRID, ground }, () => BLUE),
      size.width,
      size.height,
    );
    expect(image.rgba).toEqual(expected);
  });

  it('falls back to the typeId debugColor for lanes that resolve no pattern', async () => {
    const synthesize = createMinimapSynthesizer({
      gfxPatterns: [WATER],
      terrainPatterns: [LAND_TYPE],
      readPage: async (key) => (key === 'text_007' ? solidPage(0, 0, 255) : null),
      ...NO_HARVEST,
    });
    // Cell 0 resolves water (so the synthesizer emits); the others fall to typeId 2's debugColor.
    const a = Array.from({ length: CELLS }, (_, cell) => (cell === 0 ? 0 : 1));
    const ground = { patterns: ['water 01', 'missing'], a, b: a };
    const image = await synthesized(await synthesize({ ...GRID, ground }));
    const expected = rasterizeMinimap(
      minimapScene({ ...GRID, ground }, (cell) => (cell === 0 ? BLUE : DEBUG_GREEN)),
      image.width,
      image.height,
    );
    expect(image.rgba).toEqual(expected);
  });

  it('draws the placed trees and ore the harvest join names', async () => {
    const sources = {
      gfxPatterns: [MEADOW],
      terrainPatterns: [],
      readPage: async (key: string) => (key === 'text_001' ? solidPage(60, 140, 50) : null),
    };
    // Half-cell triples: two yews and an iron mine near the middle, and a boulder.
    const objects = {
      types: ['yew 01', 'iron mine 01', 'boulder decor 01'],
      placements: [4, 4, 0, 6, 4, 0, 6, 8, 1, 2, 8, 2],
    };
    const terrain = { ...GRID, ground: MEADOW_GROUND, objects };
    const image = await synthesized(await createMinimapSynthesizer({ ...sources, ...HARVEST })(terrain));
    const bare = await synthesized(await createMinimapSynthesizer({ ...sources, ...NO_HARVEST })(terrain));
    const lanes = minimapObjectLanes(SIZE, SIZE, objects, minimapFeatureByEditName(HARVEST));
    const meadow = (60 << 16) | (140 << 8) | 50;
    const expected = rasterizeMinimap(
      minimapScene(terrain, () => meadow, lanes),
      image.width,
      image.height,
    );
    expect(image.rgba).toEqual(expected);
    expect(image.rgba).not.toEqual(bare.rgba);
  });

  it('yields nothing without ground lanes or when no lane pattern resolves a colour', async () => {
    const synthesize = createMinimapSynthesizer({
      gfxPatterns: [WATER],
      terrainPatterns: [LAND_TYPE],
      readPage: async () => null,
      ...NO_HARVEST,
    });
    expect(await synthesize(GRID)).toBeUndefined();
    expect(
      await synthesize({ ...GRID, ground: { patterns: ['water 01'], a: [0, 0, 0, 0], b: [0, 0, 0, 0] } }),
    ).toBeUndefined();
  });
});
