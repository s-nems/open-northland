import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decodePcx, encodePcx, expandToRgba } from '../src/decoders/pcx.js';
import { decodePng } from '../src/decoders/png.js';
import { TEXTURES_DIR } from '../src/stages/game-file.js';
import { composeMaskedTransitionPages, convertPcxTree, pcxToPng } from '../src/stages/pcx.js';
import { rampPalette } from './fixtures/palette.js';
import { samplePcx } from './fixtures/pcx.js';

describe('pcxToPng', () => {
  it('decodes, palette-expands, and re-encodes to a PNG that round-trips to the same RGBA', () => {
    const { bytes } = samplePcx();
    const png = pcxToPng(bytes);
    // The PNG must reproduce exactly what the decode + palette expansion produced.
    const expected = expandToRgba(decodePcx(bytes));
    const decoded = decodePng(png);
    expect(decoded.width).toBe(expected.width);
    expect(decoded.height).toBe(expected.height);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(expected.rgba));
  });

  it('propagates a pcx error for a palette-less picture (caught per-file by the tree walk)', () => {
    const noPalette = encodePcx({ width: 2, height: 1, pixels: Uint8Array.from([3, 7]) });
    expect(() => pcxToPng(noPalette)).toThrow(/^pcx:/);
  });
});

describe('convertPcxTree', () => {
  let game: string;
  let out: string;

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'vinland-pipeline-'));
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

    const done = await convertPcxTree(game, out);

    expect(done.map((c) => c.output).sort()).toEqual([join('logo.png'), join('pics', 'gui', 'button.png')]);
    const png = await readFile(join(out, 'logo.png'));
    const decoded = decodePng(png);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    // Close the loop: the bytes that survived readFile -> pcxToPng -> writeFile -> readFile must
    // equal a direct in-memory expansion (catches a truncating/partial write, not just dimensions).
    expect(Array.from(decoded.rgba)).toEqual(Array.from(expandToRgba(decodePcx(bytes)).rgba));
  });

  it('converts in place when in/out are the same tree (the unpacked-embedded .pcx pass)', async () => {
    // The pipeline runs convertPcxTree(out, out) over the just-unpacked tree so embedded .pcx
    // (extracted from a .lib into <out>) gain a .png sibling. Source==target must write alongside,
    // not error, and must not re-walk its own output (a .png is never re-matched as a .pcx).
    const { bytes, width, height } = samplePcx();
    await mkdir(join(out, 'data', 'bobs'), { recursive: true });
    await writeFile(join(out, 'data', 'bobs', 'embedded.pcx'), bytes);

    const done = await convertPcxTree(out, out);

    expect(done.map((c) => c.output)).toEqual([join('data', 'bobs', 'embedded.png')]);
    const decoded = decodePng(await readFile(join(out, 'data', 'bobs', 'embedded.png')));
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);
    // The .png sibling is never re-matched as a .pcx, so the pass doesn't walk its own output; the
    // source .pcx survives the conversion, so a re-run simply re-converts it to identical bytes.
    expect((await convertPcxTree(out, out)).map((c) => c.output)).toEqual([
      join('data', 'bobs', 'embedded.png'),
    ]);
  });

  it('skips a malformed .pcx with a warning instead of aborting the batch', async () => {
    const { bytes } = samplePcx();
    await writeFile(join(game, 'good.pcx'), bytes);
    await writeFile(join(game, 'broken.pcx'), Uint8Array.from([0x0a, 0x05, 0x01])); // too short
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convertPcxTree(game, out);

    expect(done.map((c) => c.input)).toEqual(['good.pcx']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped broken\.pcx: pcx:/));
    warn.mockRestore();
  });

  it('throws when the game dir does not exist (a real argument error, not per-file)', async () => {
    await expect(convertPcxTree(join(game, 'nope'), out)).rejects.toThrow();
  });

  it('composes a transition texture + alpha-mask pair into one RGBA .masked.png (raw index = alpha)', async () => {
    // The colour picture expands through its palette; the MASK picture's raw palette-index bytes
    // become the alpha channel directly (the engine convention — no palette expansion for the mask).
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

    const done = await composeMaskedTransitionPages(game, out, [
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

    expect(done.map((c) => c.output)).toEqual([join(TEXTURES_DIR, 'tran_meadow.masked.png')]);
    const decoded = decodePng(await readFile(join(out, TEXTURES_DIR, 'tran_meadow.masked.png')));
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

    const done = await composeMaskedTransitionPages(game, out, [
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
