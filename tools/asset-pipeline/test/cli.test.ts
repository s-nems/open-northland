import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertPcxTree, parseArgs, pcxToPng } from '../src/cli.js';
import { decodePcx, encodePcx, expandToRgba } from '../src/decoders/pcx.js';
import { decodePng } from '../src/decoders/png.js';

/**
 * CLI wiring tests. No copyrighted fixtures: we synthesize `.pcx` bytes with the faithful `encodePcx`,
 * run the pcx -> png stage, and decode the emitted PNG back to assert the round-trip. The filesystem
 * cases use a throwaway temp dir (the pipeline is an offline build tool — Node I/O is fair game here,
 * unlike the deterministic sim).
 */

/** A 768-byte palette where entry i is (i, 255-i, (i*7) & 0xff) — every channel varies with the index. */
const rampPalette = (): Uint8Array => {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i;
    p[i * 3 + 1] = 255 - i;
    p[i * 3 + 2] = (i * 7) & 0xff;
  }
  return p;
};

/** A small indexed picture (mixes runs and an escaped >= 0xC0 value), encoded with its palette. */
const samplePcx = (): { bytes: Uint8Array; width: number; height: number } => {
  const width = 4;
  const height = 3;
  const pixels = Uint8Array.from([0, 0, 1, 200, 5, 5, 5, 5, 9, 0, 9, 0]);
  return { bytes: encodePcx({ width, height, pixels, palette: rampPalette() }), width, height };
};

describe('parseArgs', () => {
  it('reads --game/--mod/--out and defaults out to content', () => {
    expect(parseArgs(['--game', 'g', '--mod', 'm', '--out', 'o'])).toEqual({
      game: 'g',
      mod: 'm',
      out: 'o',
    });
    expect(parseArgs(['--game', 'g'])).toEqual({ game: 'g', mod: undefined, out: 'content' });
  });

  it('throws when --game is missing', () => {
    expect(() => parseArgs(['--mod', 'm'])).toThrow(/--game/);
  });
});

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
});
