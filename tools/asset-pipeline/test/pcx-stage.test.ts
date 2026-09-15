import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePcx, encodePcx, expandToRgba } from '../src/decoders/pcx.js';
import { decodePng } from '../src/decoders/png.js';
import { MOD_GUI_BITMAPS_DIR, MOD_TEXTURES_DIR } from '../src/roots.js';
import { GUI_BITMAPS_DIR, TEXTURES_DIR } from '../src/stages/content-tree.js';
import { composeMaskedTransitionPages, convertPcxTree, pcxToPng } from '../src/stages/pcx.js';
import { rampPalette } from './fixtures/palette.js';
import { samplePcx } from './fixtures/pcx.js';
import { makeTempDir } from './support/game-tree.js';

describe('pcxToPng', () => {
  it('decodes, palette-expands, and re-encodes to a PNG that round-trips to the same RGBA', async () => {
    const { bytes } = samplePcx();
    const png = await pcxToPng(bytes);
    // The PNG must reproduce exactly what the decode + palette expansion produced.
    const expected = expandToRgba(decodePcx(bytes));
    const decoded = await decodePng(png);
    expect(decoded.width).toBe(expected.width);
    expect(decoded.height).toBe(expected.height);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(expected.rgba));
  });

  it('propagates a pcx error for a palette-less picture (caught per-file by the tree walk)', async () => {
    const noPalette = encodePcx({ width: 2, height: 1, pixels: Uint8Array.from([3, 7]) });
    await expect(pcxToPng(noPalette)).rejects.toThrow(/^pcx:/);
  });
});

describe('convertPcxTree', () => {
  let game: string;
  let out: string;

  beforeEach(async () => {
    const root = (await makeTempDir('pipeline')).path;
    game = join(root, 'game');
    out = join(root, 'out');
    await mkdir(game, { recursive: true });
  });

  afterEach(async () => {
    // root is the parent of game/out; remove both via their shared parent.
    await rm(join(game, '..'), { recursive: true, force: true });
  });

  it('converts the texture pages and GUI bitmaps into their served directories as .png', async () => {
    const { bytes, width, height } = samplePcx();
    await mkdir(join(game, MOD_TEXTURES_DIR), { recursive: true });
    await mkdir(join(game, MOD_GUI_BITMAPS_DIR), { recursive: true });
    await writeFile(join(game, MOD_TEXTURES_DIR, 'text_000.pcx'), bytes);
    await writeFile(join(game, MOD_GUI_BITMAPS_DIR, 'bg_button.PCX'), bytes); // case-insensitive match
    await writeFile(join(game, MOD_TEXTURES_DIR, 'notes.txt'), 'ignore me');

    const done = await convertPcxTree({ mod: game }, out);

    expect(done.map((c) => c.output).sort()).toEqual([
      `${GUI_BITMAPS_DIR}/bg_button.png`,
      `${TEXTURES_DIR}/text_000.png`,
    ]);
    const decoded = await decodePng(await readFile(join(out, TEXTURES_DIR, 'text_000.png')));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    // Close the loop: the bytes that survived readFile -> pcxToPng -> writeFile -> readFile must
    // equal a direct in-memory expansion (catches a truncating/partial write, not just dimensions).
    expect(Array.from(decoded.rgba)).toEqual(Array.from(expandToRgba(decodePcx(bytes)).rgba));
  });

  it('lower-cases the served name whatever the source tree spelled, and leaves other pictures alone', async () => {
    // The page is fetched at `/textures/<pageKey>.png` from a lower-cased IR reference, and a
    // loader reads a 404 as absent content. Map folders and hypertext pictures have their own stages.
    const { bytes } = samplePcx();
    await mkdir(join(game, 'DATA', 'Engine2D', 'Bin', 'Textures', 'Old'), { recursive: true });
    await mkdir(join(game, 'CnModMaps', 'arena'), { recursive: true });
    await writeFile(join(game, 'DATA', 'Engine2D', 'Bin', 'Textures', 'Text_000.pcx'), bytes);
    await writeFile(join(game, 'DATA', 'Engine2D', 'Bin', 'Textures', 'Old', 'text_001.pcx'), bytes);
    await writeFile(join(game, 'CnModMaps', 'arena', 'minimap.pcx'), bytes);

    const done = await convertPcxTree({ mod: game }, out);

    expect(done.map((c) => c.output)).toEqual([`${TEXTURES_DIR}/text_000.png`]);
    await expect(readFile(join(out, TEXTURES_DIR, 'text_000.png'))).resolves.toBeInstanceOf(Buffer);
  });

  it('skips a malformed .pcx with a warning instead of aborting the batch', async () => {
    const { bytes } = samplePcx();
    await mkdir(join(game, MOD_TEXTURES_DIR), { recursive: true });
    await writeFile(join(game, MOD_TEXTURES_DIR, 'good.pcx'), bytes);
    await writeFile(join(game, MOD_TEXTURES_DIR, 'broken.pcx'), Uint8Array.from([0x0a, 0x05, 0x01])); // too short
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convertPcxTree({ mod: game }, out);

    expect(done.map((c) => c.input)).toEqual([`${MOD_TEXTURES_DIR}/good.pcx`]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped .*broken\.pcx: pcx:/));
    warn.mockRestore();
  });

  it('throws when the mod root does not exist (a real argument error, not per-file)', async () => {
    await expect(convertPcxTree({ mod: join(game, 'nope') }, out)).rejects.toThrow();
  });

  it('composes a transition texture + alpha-mask pair into one RGBA .masked.png (raw index = alpha)', async () => {
    // The colour picture expands through its palette; the MASK picture's raw palette-index bytes
    // become the alpha channel directly (the engine convention - no palette expansion for the mask).
    // The IR hands the LOWERCASED normalized paths; the stage must still resolve the real-cased
    // Data/engine2d/bin/textures tree and write into the served textures/ directory.
    const width = 2;
    const height = 2;
    const colour = encodePcx({
      width,
      height,
      pixels: Uint8Array.from([1, 2, 3, 4]),
      palette: rampPalette(),
    });
    const mask = encodePcx({
      width,
      height,
      pixels: Uint8Array.from([0, 128, 200, 255]),
      palette: rampPalette(),
    });
    await mkdir(join(game, MOD_TEXTURES_DIR), { recursive: true });
    await writeFile(join(game, MOD_TEXTURES_DIR, 'tran_meadow.pcx'), colour);
    await writeFile(join(game, MOD_TEXTURES_DIR, 'tran_meadow_a.pcx'), mask);

    const done = await composeMaskedTransitionPages({ mod: game }, out, [
      {
        texture: 'data/engine2d/bin/textures/tran_meadow.pcx',
        textureAlpha: 'data/engine2d/bin/textures/tran_meadow_a.pcx',
      },
      // A duplicate pair (two [transition] records sharing one page) must compose only once.
      {
        texture: 'data/engine2d/bin/textures/tran_meadow.pcx',
        textureAlpha: 'data/engine2d/bin/textures/tran_meadow_a.pcx',
      },
    ]);

    expect(done.map((c) => c.output)).toEqual([`${TEXTURES_DIR}/tran_meadow.masked.png`]);
    const decoded = await decodePng(await readFile(join(out, TEXTURES_DIR, 'tran_meadow.masked.png')));
    const expectedRgb = expandToRgba(decodePcx(colour)).rgba;
    for (let i = 0; i < width * height; i++) {
      expect(decoded.rgba[4 * i]).toBe(expectedRgb[4 * i]);
      expect(decoded.rgba[4 * i + 1]).toBe(expectedRgb[4 * i + 1]);
      expect(decoded.rgba[4 * i + 2]).toBe(expectedRgb[4 * i + 2]);
    }
    expect([decoded.rgba[3], decoded.rgba[7], decoded.rgba[11], decoded.rgba[15]]).toEqual([
      0, 128, 200, 255,
    ]);
  });

  it('skips a masked pair whose mask dimensions mismatch, with a warning (per-file boundary)', async () => {
    const colour = encodePcx({
      width: 2,
      height: 2,
      pixels: Uint8Array.from([1, 2, 3, 4]),
      palette: rampPalette(),
    });
    const mask = encodePcx({ width: 1, height: 1, pixels: Uint8Array.from([9]), palette: rampPalette() });
    await mkdir(join(game, MOD_TEXTURES_DIR), { recursive: true });
    await writeFile(join(game, MOD_TEXTURES_DIR, 'tran_bad.pcx'), colour);
    await writeFile(join(game, MOD_TEXTURES_DIR, 'tran_bad_a.pcx'), mask);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await composeMaskedTransitionPages({ mod: game }, out, [
      {
        texture: 'data/engine2d/bin/textures/tran_bad.pcx',
        textureAlpha: 'data/engine2d/bin/textures/tran_bad_a.pcx',
      },
    ]);

    expect(done).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped masked page .*tran_bad/));
    warn.mockRestore();
  });
});
