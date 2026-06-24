import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bmdToAtlas,
  buildIr,
  convertBmdTree,
  convertPcxTree,
  libMemberRelPath,
  parseArgs,
  pcxToPng,
  resolveArgs,
  resolveGraphicsBindings,
  resolveIniSources,
  unpackLibTree,
} from '../src/cli.js';
import { BOB_TYPE_8BIT, type Bmd, PACKED_X_SHIFT, encodeBmd } from '../src/decoders/bmd.js';
import type { BmdPaletteBinding, PaletteAlias } from '../src/decoders/ini.js';
import { encodeLib } from '../src/decoders/lib.js';
import { decodePcx, encodePcx, expandToRgba } from '../src/decoders/pcx.js';
import { decodePng, encodePng } from '../src/decoders/png.js';

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

/** One 8-bit bob (id firstBobId=10), a 2×1 raw run of indices [4,8], serialized as a real `.bmd`. */
const sampleBmdBytes = (): Uint8Array => {
  const bmd: Bmd = {
    version: 0,
    firstBobId: 10,
    bobCount: 1,
    generatedNonEmptyLines: 0,
    generatedEmptyLines: 0,
    generatedPackedLines: 0,
    bobs: [{ type: BOB_TYPE_8BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 0 }],
    packedLineData: Uint8Array.from([0x02, 4, 8, 0x00]),
    lineControl: Uint32Array.from([(0 << PACKED_X_SHIFT) | 0]),
  };
  return encodeBmd(bmd);
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

describe('resolveArgs', () => {
  // The bug this guards: npm runs the workspace `start` script with cwd=tools/asset-pipeline/, so a
  // relative `--game ../Cultures 8th Wonder` must resolve against INIT_CWD (repo root), not cwd.
  it('resolves relative game/out against baseDir; mod stays a bare subdir', () => {
    expect(
      resolveArgs({ game: '../Cultures 8th Wonder', mod: 'DataCnmd', out: 'content' }, '/home/u/vinland'),
    ).toEqual({
      game: '/home/u/Cultures 8th Wonder',
      mod: 'DataCnmd',
      out: '/home/u/vinland/content',
    });
  });

  it('passes absolute game/out through unchanged', () => {
    expect(resolveArgs({ game: '/abs/game', mod: undefined, out: '/abs/out' }, '/home/u/vinland')).toEqual({
      game: '/abs/game',
      mod: undefined,
      out: '/abs/out',
    });
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

describe('bmdToAtlas', () => {
  it('decodes a .bmd, packs an atlas, and yields a PNG-encodable image + manifest', () => {
    const atlas = bmdToAtlas(sampleBmdBytes(), rampPalette());
    expect(atlas.manifest.frames).toHaveLength(1);
    const frame = atlas.manifest.frames[0];
    expect(frame?.bobId).toBe(10);
    expect(frame?.rect.width).toBe(2);
    expect(frame?.opaque).toBe(true);
    // The atlas image round-trips through the PNG encoder (proves it is a valid RGBA sheet).
    const png = encodePng(atlas.image);
    const decoded = decodePng(png);
    expect(decoded.width).toBe(atlas.image.width);
    expect(decoded.height).toBe(atlas.image.height);
    // Manifest dimensions must agree with the image it describes.
    expect(atlas.manifest.width).toBe(atlas.image.width);
    expect(atlas.manifest.height).toBe(atlas.image.height);
  });

  it('propagates a bmd error for a non-CBobManager buffer (caught per-file by a tree walk)', () => {
    const notBmd = new Uint8Array(36);
    new DataView(notBmd.buffer).setUint32(0, 0x3e9, true); // CMemory id, not 0x3F4
    expect(() => bmdToAtlas(notBmd, rampPalette())).toThrow(/^bmd:/);
  });

  it('propagates an atlas error for a wrong-sized palette', () => {
    expect(() => bmdToAtlas(sampleBmdBytes(), new Uint8Array(100))).toThrow(/^atlas:/);
  });
});

describe('libMemberRelPath', () => {
  it('rewrites backslash member paths to a native relative path', () => {
    expect(libMemberRelPath('data\\engine2d\\bin\\bobs\\ls_bridge.bmd')).toBe(
      join('data', 'engine2d', 'bin', 'bobs', 'ls_bridge.bmd'),
    );
    expect(libMemberRelPath('logo.pcx')).toBe('logo.pcx');
  });

  it('rejects names that would escape the extraction root', () => {
    expect(libMemberRelPath('..\\..\\etc\\passwd')).toBeUndefined();
    expect(libMemberRelPath('a\\..\\..\\b')).toBeUndefined();
    expect(libMemberRelPath('')).toBeUndefined();
    expect(libMemberRelPath('.')).toBeUndefined();
  });
});

describe('unpackLibTree', () => {
  let game: string;
  let out: string;

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'vinland-lib-'));
    game = join(root, 'game');
    out = join(root, 'out');
    await mkdir(game, { recursive: true });
  });

  afterEach(async () => {
    await rm(join(game, '..'), { recursive: true, force: true });
  });

  it('extracts every member of every .lib under the game tree, mirroring its internal path', async () => {
    const lib = encodeLib({
      files: [
        { name: 'data\\logic\\goodtypes.cif', data: Uint8Array.from([1, 2, 3, 4]) },
        { name: 'logo.pcx', data: Uint8Array.from([9, 8, 7]) },
      ],
    });
    await mkdir(join(game, 'DataX', 'Libs'), { recursive: true });
    await writeFile(join(game, 'DataX', 'Libs', 'data0001.lib'), lib);
    await writeFile(join(game, 'notes.txt'), 'ignore me'); // not a .lib

    const done = await unpackLibTree(game, out);

    expect(done.map((e) => e.member).sort()).toEqual([join('data', 'logic', 'goodtypes.cif'), 'logo.pcx']);
    expect(done.every((e) => e.archive === join('DataX', 'Libs', 'data0001.lib'))).toBe(true);
    // The bytes that survived the round-trip must equal what we packed.
    expect(Array.from(await readFile(join(out, 'data', 'logic', 'goodtypes.cif')))).toEqual([1, 2, 3, 4]);
    expect(Array.from(await readFile(join(out, 'logo.pcx')))).toEqual([9, 8, 7]);
  });

  it('skips a member with an unsafe (escaping) name instead of writing outside out', async () => {
    const lib = encodeLib({
      files: [
        { name: '..\\escape.bin', data: Uint8Array.from([1]) },
        { name: 'safe.bin', data: Uint8Array.from([2]) },
      ],
    });
    await writeFile(join(game, 'a.lib'), lib);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await unpackLibTree(game, out);

    expect(done.map((e) => e.member)).toEqual(['safe.bin']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unsafe member ".*escape\.bin"/));
    warn.mockRestore();
  });

  it('skips a corrupt .lib with a warning instead of aborting the batch', async () => {
    const good = encodeLib({ files: [{ name: 'ok.bin', data: Uint8Array.from([5]) }] });
    await writeFile(join(game, 'good.lib'), good);
    await writeFile(join(game, 'broken.lib'), Uint8Array.from([1, 0, 0])); // truncated header
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await unpackLibTree(game, out);

    expect(done.map((e) => e.member)).toEqual(['ok.bin']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped archive broken\.lib:/));
    warn.mockRestore();
  });

  it('throws when the game dir does not exist (a real argument error, not per-file)', async () => {
    await expect(unpackLibTree(join(game, 'nope'), out)).rejects.toThrow();
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
});

describe('convertBmdTree', () => {
  let out: string;

  beforeEach(async () => {
    out = await mkdtemp(join(tmpdir(), 'vinland-bmd-'));
  });

  afterEach(async () => {
    await rm(out, { recursive: true, force: true });
  });

  /** Lays down a palette `.pcx` and a body `.bmd` under <out> at MIXED-case paths (like the real lib). */
  const layDownAssets = async (): Promise<void> => {
    await mkdir(join(out, 'Data', 'Pal'), { recursive: true });
    await mkdir(join(out, 'Data', 'Bobs'), { recursive: true });
    await writeFile(join(out, 'Data', 'Pal', 'Bear01.pcx'), samplePcx().bytes);
    await writeFile(join(out, 'Data', 'Bobs', 'Body.bmd'), sampleBmdBytes());
  };

  /** A binding + palette index referencing the laid-down assets by their LOWER-cased (normalized) paths. */
  const sampleBinding = (): { bindings: BmdPaletteBinding[]; palettes: PaletteAlias[] } => ({
    bindings: [
      { bmd: 'data/bobs/body.bmd', shadowBmd: undefined, paletteName: 'bear01', tribeId: 1, jobId: 2 },
    ],
    palettes: [{ name: 'bear01', gfxFile: 'data/pal/bear01.pcx' }],
  });

  it('resolves a binding to its palette .pcx + body .bmd and writes an atlas PNG + manifest', async () => {
    await layDownAssets();
    const { bindings, palettes } = sampleBinding();

    const done = await convertBmdTree(bindings, palettes, out);

    expect(done).toHaveLength(1);
    // The case-insensitive resolution maps the normalized refs onto the real mixed-case on-disk paths.
    expect(done[0]?.png).toBe(join('Data', 'Bobs', 'Body.png'));
    expect(done[0]?.manifest).toBe(join('Data', 'Bobs', 'Body.atlas.json'));
    // The emitted PNG decodes (a valid RGBA sheet) and the manifest JSON round-trips its frame table.
    const decoded = decodePng(await readFile(join(out, 'Data', 'Bobs', 'Body.png')));
    expect(decoded.width).toBeGreaterThan(0);
    const manifest = JSON.parse(await readFile(join(out, 'Data', 'Bobs', 'Body.atlas.json'), 'utf8'));
    expect(manifest.frames).toHaveLength(1);
    expect(manifest.frames[0].bobId).toBe(10);
    expect(manifest.width).toBe(decoded.width);
    expect(manifest.height).toBe(decoded.height);
  });

  it('skips a binding whose palette editname is not in the index, with a warning', async () => {
    await layDownAssets();
    const { bindings } = sampleBinding();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convertBmdTree(bindings, [], out); // empty palette index

    expect(done).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unknown palette "bear01"/));
    warn.mockRestore();
  });

  it('skips a binding whose .bmd is missing under out, with a warning', async () => {
    // Palette .pcx present, body .bmd absent.
    await mkdir(join(out, 'Data', 'Pal'), { recursive: true });
    await writeFile(join(out, 'Data', 'Pal', 'Bear01.pcx'), samplePcx().bytes);
    const { bindings, palettes } = sampleBinding();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convertBmdTree(bindings, palettes, out);

    expect(done).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/bmd data\/bobs\/body\.bmd not found/));
    warn.mockRestore();
  });

  it('skips a binding whose .bmd is malformed, with a warning (one bad bob set does not abort)', async () => {
    await mkdir(join(out, 'Data', 'Pal'), { recursive: true });
    await mkdir(join(out, 'Data', 'Bobs'), { recursive: true });
    await writeFile(join(out, 'Data', 'Pal', 'Bear01.pcx'), samplePcx().bytes);
    await writeFile(join(out, 'Data', 'Bobs', 'Body.bmd'), new Uint8Array(8)); // not a CBobManager
    const { bindings, palettes } = sampleBinding();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await convertBmdTree(bindings, palettes, out);

    expect(done).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped data\/bobs\/body\.bmd:/));
    warn.mockRestore();
  });
});

describe('resolveGraphicsBindings', () => {
  let game: string;

  beforeEach(async () => {
    game = await mkdtemp(join(tmpdir(), 'vinland-gfx-'));
  });

  afterEach(async () => {
    await rm(game, { recursive: true, force: true });
  });

  it('reads the readable jobgraphics + palettes inis into bindings + palette aliases', async () => {
    const inis = join('Data', 'engine2d', 'inis');
    await mkdir(join(game, inis, 'animals'), { recursive: true });
    await mkdir(join(game, inis, 'palettes'), { recursive: true });
    await writeFile(
      join(game, inis, 'animals', 'jobgraphics.ini'),
      '[jobgraphics]\ngfxbobmanagerbody "Data\\Bobs\\Body.bmd"\ngfxpalettebody "Bear01"\n',
    );
    await writeFile(
      join(game, inis, 'palettes', 'palettes.ini'),
      '[GfxPalette256]\neditname "Bear01"\ngfxfile "data\\pal\\bear01.pcx"\n',
    );

    const { bindings, palettes } = await resolveGraphicsBindings(game);

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.bmd).toBe('data/bobs/body.bmd');
    expect(bindings[0]?.paletteName).toBe('bear01');
    expect(palettes).toEqual([{ name: 'bear01', gfxFile: 'data/pal/bear01.pcx' }]);
  });

  it('returns empty lists with a warning when a binding source is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { bindings, palettes } = await resolveGraphicsBindings(game); // nothing laid down

    expect(bindings).toEqual([]);
    expect(palettes).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/jobgraphics\.ini/));
    warn.mockRestore();
  });
});

/**
 * IR-build wiring tests. We lay down synthetic `.ini` files at the real expected paths (base
 * `Data/logic/*`, mod `DataCnmd/*`) so the source-resolution + extract + validate path is exercised
 * without any copyrighted bytes — the grammar, not the game's data, is what's under test here.
 */
describe('buildIr / resolveIniSources', () => {
  let game: string;

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'vinland-ir-'));
    game = join(root, 'game');
    await mkdir(join(game, 'Data', 'logic'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'tribetypes12'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'atomicanimations12'), { recursive: true });
    await writeFile(
      join(game, 'Data', 'logic', 'goodtypes.ini'),
      '[goodtype]\nname "wood"\ntype 7\natomicForHarvesting 26\n',
    );
    await writeFile(
      join(game, 'Data', 'logic', 'jobtypes.ini'),
      '[jobtype]\ntype 3\nname "carrier"\nallowatomic 5\nbaseatomics 1\n',
    );
    await writeFile(
      join(game, 'Data', 'logic', 'landscapetypes.ini'),
      '[landscapetype]\ntype 2\nname "grass"\n',
    );
    await writeFile(
      join(game, 'DataCnmd', 'tribetypes12', 'tribetypes.ini'),
      '[tribetype]\ntype 1\nname "viking"\nsetatomic 3 5 "viking_carry"\n',
    );
    await writeFile(
      join(game, 'DataCnmd', 'atomicanimations12', 'atomicanimations.ini'),
      '[atomicanimation]\nname "viking_carry"\nlength 40\ninterruptable 1\n',
    );
  });

  afterEach(async () => {
    await rm(join(game, '..'), { recursive: true, force: true });
  });

  it('reads the readable .ini sources and assembles a validated ContentSet', async () => {
    const set = await buildIr({ game, mod: 'DataCnmd', out: 'unused' });

    expect(set.manifest.version).toBe(1);
    expect(set.manifest.generatedFrom).toEqual({ game, mod: 'DataCnmd' });
    expect(set.goods.map((g) => g.id)).toEqual(['wood']);
    expect(set.goods[0]?.atomics.harvest).toBe(26);
    expect(set.jobs.map((j) => j.id)).toEqual(['carrier']);
    expect(set.jobs[0]?.allowedAtomics).toEqual([5]);
    expect(set.landscape.map((l) => l.id)).toEqual(['grass']);
    expect(set.tribes.map((t) => t.id)).toEqual(['viking']);
    expect(set.atomicAnimations.map((a) => a.name)).toEqual(['viking_carry']);
    // Provenance stamps the mod layer on a DataCnmd source, base on a Data/logic one.
    expect(set.goods[0]?.source?.layer).toBe('base');
    expect(set.tribes[0]?.source?.layer).toBe('mod');
  });

  it('cross-validates: a tribe binding to an absent jobType fails parseContentSet', async () => {
    // Point the tribe's setatomic at jobType 99, which no [jobtype] defines.
    await writeFile(
      join(game, 'DataCnmd', 'tribetypes12', 'tribetypes.ini'),
      '[tribetype]\ntype 1\nname "viking"\nsetatomic 99 5 "viking_carry"\n',
    );
    await expect(buildIr({ game, mod: 'DataCnmd', out: 'unused' })).rejects.toThrow(/unknown jobType 99/);
  });

  it('drops a missing source with a warning instead of aborting (no mod -> no tribe sources)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // No --mod, so the mod-only tribe/atomic sources are never requested; base files still load.
    const noMod = await resolveIniSources(game, undefined);
    expect(noMod.map((s) => s.file).sort()).toEqual([
      join('Data', 'logic', 'goodtypes.ini'),
      join('Data', 'logic', 'jobtypes.ini'),
      join('Data', 'logic', 'landscapetypes.ini'),
    ]);

    // Remove a base file: it's resolved-away with a warning, not a throw.
    await rm(join(game, 'Data', 'logic', 'goodtypes.ini'));
    const partial = await resolveIniSources(game, 'DataCnmd');
    expect(partial.some((s) => s.file.endsWith('goodtypes.ini'))).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/not found.*goodtypes\.ini/));

    const set = await buildIr({ game, mod: 'DataCnmd', out: 'unused' });
    expect(set.goods).toEqual([]); // missing goods source -> empty, rest still present
    expect(set.jobs.length).toBe(1);
    warn.mockRestore();
  });
});
