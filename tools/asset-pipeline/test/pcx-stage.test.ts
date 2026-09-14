import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vjoin } from '@open-northland/vfs';
import { nodeVfs } from '@open-northland/vfs/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePcx, encodePcx, expandToRgba } from '../src/decoders/pcx.js';
import { decodePng } from '../src/decoders/png.js';
import { TEXTURES_DIR } from '../src/stages/content-tree.js';
import { composeMaskedTransitionPages, convertPcxTree, pcxToPng } from '../src/stages/pcx.js';
import { rampPalette } from './fixtures/palette.js';
import { samplePcx } from './fixtures/pcx.js';
import { makeTempDir } from './support/game-tree.js';

const fs = nodeVfs();

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

  it('mirrors every .pcx into the out dir as a .png, preserving the subtree', async () => {
    const { bytes, width, height } = samplePcx();
    await mkdir(join(game, 'pics', 'gui'), { recursive: true });
    await writeFile(join(game, 'logo.pcx'), bytes);
    await writeFile(join(game, 'pics', 'gui', 'button.PCX'), bytes); // case-insensitive match
    await writeFile(join(game, 'pics', 'notes.txt'), 'ignore me');

    const done = await convertPcxTree(fs, { mod: game }, out);

    expect(done.map((c) => c.output).sort()).toEqual(['logo.png', 'pics/gui/button.png']);
    const png = await readFile(join(out, 'logo.png'));
    const decoded = await decodePng(png);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    // Close the loop: the bytes that survived readFile -> pcxToPng -> writeFile -> readFile must
    // equal a direct in-memory expansion (catches a truncating/partial write, not just dimensions).
    expect(Array.from(decoded.rgba)).toEqual(Array.from(expandToRgba(decodePcx(bytes)).rgba));
  });

  it('writes a served subtree at the route spelling, whatever the source layer spelled', async () => {
    // A loose tree may spell the textures root any way a case-insensitive host accepted; the page
    // is served at `/textures/<pageKey>.png` and the loaders read a 404 as absent content.
    const { bytes } = samplePcx();
    await mkdir(join(game, 'DATA', 'Engine2D', 'Bin', 'Textures'), { recursive: true });
    await writeFile(join(game, 'DATA', 'Engine2D', 'Bin', 'Textures', 'Text_000.pcx'), bytes);

    const done = await convertPcxTree(fs, { mod: game }, out);

    expect(done.map((c) => c.output)).toEqual([vjoin(TEXTURES_DIR, 'text_000.png')]);
    await expect(readFile(join(out, TEXTURES_DIR, 'text_000.png'))).resolves.toBeInstanceOf(Buffer);
  });

  it('skips a malformed .pcx with a warning instead of aborting the batch', async () => {
    const { bytes } = samplePcx();
    await writeFile(join(game, 'good.pcx'), bytes);
    await writeFile(join(game, 'broken.pcx'), Uint8Array.from([0x0a, 0x05, 0x01])); // too short
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convertPcxTree(fs, { mod: game }, out);

    expect(done.map((c) => c.input)).toEqual(['good.pcx']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped broken\.pcx: pcx:/));
    warn.mockRestore();
  });

  it('throws when the mod root does not exist (a real argument error, not per-file)', async () => {
    await expect(convertPcxTree(fs, { mod: join(game, 'nope') }, out)).rejects.toThrow();
  });

  it('composes a transition texture + alpha-mask pair into one RGBA .masked.png (raw index = alpha)', async () => {
    // The colour picture expands through its palette; the MASK picture's raw palette-index bytes
    // become the alpha channel directly (the engine convention - no palette expansion for the mask).
    // The IR hands the LOWERCASED normalized paths; the stage must still resolve the real-cased
    // Data/engine2d/bin/textures tree and write back into it (the /textures serving contract).
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
    await mkdir(join(game, TEXTURES_DIR), { recursive: true });
    await writeFile(join(game, TEXTURES_DIR, 'tran_meadow.pcx'), colour);
    await writeFile(join(game, TEXTURES_DIR, 'tran_meadow_a.pcx'), mask);

    const done = await composeMaskedTransitionPages(fs, { mod: game }, out, [
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

    expect(done.map((c) => c.output)).toEqual([vjoin(TEXTURES_DIR, 'tran_meadow.masked.png')]);
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
    await mkdir(join(game, TEXTURES_DIR), { recursive: true });
    await writeFile(join(game, TEXTURES_DIR, 'tran_bad.pcx'), colour);
    await writeFile(join(game, TEXTURES_DIR, 'tran_bad_a.pcx'), mask);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await composeMaskedTransitionPages(fs, { mod: game }, out, [
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
