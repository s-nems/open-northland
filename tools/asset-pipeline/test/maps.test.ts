import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodePcx } from '../src/decoders/pcx.js';
import { decodePng } from '../src/decoders/png.js';
import { decodeMapTree, mapCifToInfo, mapIdFromPath, minimapToPng } from '../src/stages/maps/index.js';
import { buildStringCif, sampleMapLines } from './fixtures/cif.js';
import { rampPalette } from './fixtures/palette.js';
import { makeTempDir } from './support/game-tree.js';

describe('mapIdFromPath', () => {
  it('slugs the containing folder name (lower-case, non-alphanumerics -> _)', () => {
    expect(mapIdFromPath(join('CnModMaps', 'tutorial_002', 'map.cif'))).toBe('tutorial_002');
    expect(mapIdFromPath(join('CnModMaps', 'SPECJALNA- FORTECA', 'map.cif'))).toBe('specjalna_forteca');
  });

  it('handles forward-slash paths regardless of host separator', () => {
    expect(mapIdFromPath('CnModMaps/Zgielk2/map.cif')).toBe('zgielk2');
  });
});

describe('mapCifToInfo', () => {
  it('decodes a synthetic map.cif logic header into a validated MapInfo', () => {
    const info = mapCifToInfo(buildStringCif(sampleMapLines()), 'tutorial_002', {
      file: join('CnModMaps', 'tutorial_002', 'map.cif'),
    });
    expect(info).toMatchObject({ id: 'tutorial_002', width: 142, height: 146, mapType: 1 });
    expect(info.guid).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(info.campaign).toEqual({ campaignId: 100, missionId: 2 });
  });

  it('throws on a .cif whose root is not a CStringArray (not a map)', () => {
    // A truncated/garbage buffer: the CStringArray id check in decodeCifStringArray rejects it.
    expect(() => mapCifToInfo(Uint8Array.from([1, 2, 3, 4, 0, 0, 0, 0]), 'x', { file: 'x' })).toThrow();
  });
});

describe('decodeMapTree', () => {
  let root: string;
  let game: string;

  beforeEach(async () => {
    root = (await makeTempDir('maps')).path;
    game = join(root, 'game');
    await mkdir(join(game, 'CnModMaps', 'tutorial_002'), { recursive: true });
    await mkdir(join(game, 'CnModMaps', 'forteca'), { recursive: true });
    await writeFile(join(game, 'CnModMaps', 'tutorial_002', 'map.cif'), buildStringCif(sampleMapLines()));
    await writeFile(
      join(game, 'CnModMaps', 'forteca', 'map.cif'),
      buildStringCif([
        { level: 1, text: 'logiccontrol' },
        { level: 2, text: 'mapsize 250 250' },
        { level: 2, text: 'mapguid 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16' },
        { level: 1, text: 'misc_maptype' },
        { level: 2, text: 'maptype 4' },
      ]),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('decodes every map.cif under the tree, sorted by relative path, id from folder', async () => {
    const maps = await decodeMapTree(game);
    expect(maps.map((m) => m.id)).toEqual(['forteca', 'tutorial_002']); // sorted by rel path
    expect(maps.find((m) => m.id === 'tutorial_002')).toMatchObject({ width: 142, height: 146, mapType: 1 });
    expect(maps.find((m) => m.id === 'forteca')?.campaign).toBeUndefined();
  });

  it('skips a malformed map.cif with a warning instead of aborting the batch', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(join(game, 'CnModMaps', 'forteca', 'map.cif'), Uint8Array.from([0, 1, 2, 3]));
    const maps = await decodeMapTree(game);
    expect(maps.map((m) => m.id)).toEqual(['tutorial_002']); // the good one still decodes
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped map.*forteca/));
    warn.mockRestore();
  });
});

describe('minimapToPng', () => {
  // The filler is keyed by palette INDEX 0 (its RGB varies across the corpus — magenta, blue, brown),
  // so the fixtures only need index 0 as the frame; rampPalette's entry 0 = (0, 255, 0) stands in.

  it('keys the border-connected index-0 filler transparent and crops to the real map pixels', () => {
    // A 4×2 canvas whose real pixels occupy the middle 2×1 (indices 1/2); the rest is index-0 filler.
    const pcx = encodePcx({
      width: 4,
      height: 2,
      pixels: Uint8Array.from([0, 0, 0, 0, 0, 1, 2, 0]),
      palette: rampPalette(),
    });
    const png = decodePng(minimapToPng(pcx));
    expect({ width: png.width, height: png.height }).toEqual({ width: 2, height: 1 });
    // rampPalette entry 1 = (1, 254, 7), entry 2 = (2, 253, 14), both fully opaque after the crop.
    expect(Array.from(png.rgba)).toEqual([1, 254, 7, 255, 2, 253, 14, 255]);
  });

  it('keeps an ENCLOSED index-0 pixel opaque (map content, not filler)', () => {
    // 5×5: an index-0 frame, a ring of real pixels, and an enclosed index-0 hole in the middle. The
    // border flood fill keys only the frame; the hole mirrors the sparse index-0 speckles observed
    // INSIDE the two full-bleed shipped minimaps — content, so it stays opaque.
    const pcx = encodePcx({
      width: 5,
      height: 5,
      // biome-ignore format: the grid reads as the picture
      pixels: Uint8Array.from([
        0, 0, 0, 0, 0,
        0, 1, 1, 1, 0,
        0, 1, 0, 1, 0,
        0, 1, 1, 1, 0,
        0, 0, 0, 0, 0,
      ]),
      palette: rampPalette(),
    });
    const png = decodePng(minimapToPng(pcx));
    expect({ width: png.width, height: png.height }).toEqual({ width: 3, height: 3 });
    const center = (1 * 3 + 1) * 4;
    expect(png.rgba[center + 3]).toBe(255); // enclosed index-0 = content, kept opaque
    expect(png.rgba[(0 * 3 + 0) * 4 + 3]).toBe(255); // the real ring survives
  });

  it('keys a ragged filler intrusion inside the crop box to alpha 0', () => {
    // The filler bites into the picture's bounding box (BLEKINY_NURT-style ragged edge): (1,0) is
    // index 0 connected to the frame, inside the crop — transparent, while the columns stay.
    const pcx = encodePcx({
      width: 4,
      height: 3,
      // biome-ignore format: the grid reads as the picture
      pixels: Uint8Array.from([
        0, 0, 0, 0,
        0, 1, 0, 2,
        0, 1, 2, 2,
      ]),
      palette: rampPalette(),
    });
    const png = decodePng(minimapToPng(pcx));
    expect({ width: png.width, height: png.height }).toEqual({ width: 3, height: 2 });
    expect(png.rgba[(0 * 3 + 1) * 4 + 3]).toBe(0); // the intruding filler pixel, transparent
    expect(png.rgba[(1 * 3 + 1) * 4 + 3]).toBe(255); // the real pixel below it, opaque
  });

  it('throws on an all-filler picture (nothing to crop to)', () => {
    const pcx = encodePcx({
      width: 2,
      height: 1,
      pixels: Uint8Array.from([0, 0]),
      palette: rampPalette(),
    });
    expect(() => minimapToPng(pcx)).toThrow(/filler/);
  });
});
