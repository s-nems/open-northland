import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bmdToAtlas,
  buildIr,
  convertBmdTree,
  convertPcxTree,
  decodeMapTree,
  jobBaseGraphicsToBindings,
  libMemberRelPath,
  mapCifToInfo,
  mapIdFromPath,
  parseArgs,
  pcxToPng,
  resolveArgs,
  resolveGraphicsBindings,
  resolveIniSources,
  unpackLibTree,
} from '../src/cli.js';
import { BOB_TYPE_8BIT, type Bmd, PACKED_X_SHIFT, encodeBmd } from '../src/decoders/bmd.js';
import { StorableId, encryptMode1 } from '../src/decoders/cif.js';
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

/**
 * Serializes level-tagged lines into a real `map.cif` `CStringArray` byte stream (offsets + pool
 * encrypted exactly as the original), so the map stage can be exercised end-to-end without committing a
 * copyrighted fixture. Mirrors `buildCif` in cif.test.ts — kept local rather than exported from the
 * decoder, which only needs to decode.
 */
const buildMapCif = (lines: ReadonlyArray<{ level: number; text: string }>): Uint8Array => {
  const chunks: number[] = [];
  const offsetValues: number[] = [];
  for (const { level, text } of lines) {
    offsetValues.push(chunks.length);
    if (level > 0) chunks.push(level);
    for (const ch of text) chunks.push(ch.charCodeAt(0) & 0xff);
    chunks.push(0);
  }
  const pool = Uint8Array.from(chunks);
  const offsets = new Uint8Array(offsetValues.length * 4);
  const ov = new DataView(offsets.buffer);
  offsetValues.forEach((v, i) => ov.setUint32(i * 4, v, true));
  encryptMode1(offsets);
  encryptMode1(pool);

  const out: number[] = [];
  const pushU32 = (v: number): void => {
    out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  };
  const pushCMemory = (data: Uint8Array): void => {
    pushU32(StorableId.CMemory);
    pushU32(0);
    pushU32(data.length);
    for (const byte of data) out.push(byte);
  };
  pushU32(StorableId.CStringArray);
  pushU32(0);
  pushU32(1); // forceSequentialIds
  pushU32(lines.length); // stringCount
  pushU32(lines.length); // usedIdCount
  pushU32(lines.length); // slotCount
  pushU32(pool.length); // stringPoolUsedBytes
  pushCMemory(offsets);
  out.push(1); // hasStringPool
  pushCMemory(pool);
  return Uint8Array.from(out);
};

/** A minimal campaign-map logic header: mapsize/mapguid + maptype/mapname metadata. */
const sampleMapLines = (): { level: number; text: string }[] => [
  { level: 1, text: 'logiccontrol' },
  { level: 2, text: 'mapsize 142 146' },
  { level: 2, text: 'mapguid 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16' },
  { level: 1, text: 'logiccontrolend' },
  { level: 1, text: 'misc_maptype' },
  { level: 2, text: 'maptype 1' },
  { level: 2, text: 'mapcampaignid 100 2' },
];

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

    const { bindings, palettes } = await resolveGraphicsBindings(game, undefined);

    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.bmd).toBe('data/bobs/body.bmd');
    expect(bindings[0]?.paletteName).toBe('bear01');
    expect(palettes).toEqual([{ name: 'bear01', gfxFile: 'data/pal/bear01.pcx' }]);
  });

  it('merges the mod [jobbasegraphics] human body/head bobs onto the base animals bindings', async () => {
    const inis = join('Data', 'engine2d', 'inis');
    await mkdir(join(game, inis, 'animals'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'types', 'humanstype'), { recursive: true });
    await writeFile(
      join(game, inis, 'animals', 'jobgraphics.ini'),
      '[jobgraphics]\ngfxbobmanagerbody "Data\\Bobs\\Lion.bmd"\ngfxpalettebody "Lion01"\n',
    );
    await writeFile(
      join(game, 'DataCnmd', 'types', 'humanstype', 'jobgraphics.ini'),
      '[jobbasegraphics]\nlogictribe 1\nlogicjob 6\n' +
        'gfxbobmanagerbody 0 "Data\\Bobs\\Body00.bmd" "Data\\Bobs\\Body00_s.bmd"\n' +
        'gfxbobmanagerhead 0 "Data\\Bobs\\Head00.bmd"\n' +
        'gfxbobmanagerhead 1 "Data\\Bobs\\Head01.bmd"\n' +
        'gfxpalettebasebody "human_body"\ngfxpalettebasehead "human_head"\ngfxpaletterandom "Vik_Man_Base"\n',
    );

    const { bindings } = await resolveGraphicsBindings(game, 'DataCnmd');

    // Base animals binding first, then the flattened mod body + head slots.
    expect(bindings.map((b) => [b.bmd, b.paletteName])).toEqual([
      ['data/bobs/lion.bmd', 'lion01'],
      ['data/bobs/body00.bmd', 'human_body'],
      ['data/bobs/head00.bmd', 'human_head'],
      ['data/bobs/head01.bmd', 'human_head'],
    ]);
    // The body slot keeps its shadow + cross-refs; the random tint is not emitted as a binding.
    expect(bindings[1]?.shadowBmd).toBe('data/bobs/body00_s.bmd');
    expect(bindings[1]?.tribeId).toBe(1);
    expect(bindings[1]?.jobId).toBe(6);
    expect(bindings.some((b) => b.paletteName === 'vik_man_base')).toBe(false);
  });

  it('merges the base-game humans/jobgraphics.cif [jobbasegraphics] records (the .cif-only leg)', async () => {
    const inis = join('Data', 'engine2d', 'inis');
    await mkdir(join(game, inis, 'animals'), { recursive: true });
    await mkdir(join(game, inis, 'humans'), { recursive: true });
    await writeFile(
      join(game, inis, 'animals', 'jobgraphics.ini'),
      '[jobgraphics]\ngfxbobmanagerbody "Data\\Bobs\\Lion.bmd"\ngfxpalettebody "Lion01"\n',
    );
    // The base human graphics ship only as encrypted .cif, decoded via the same CStringArray path.
    await writeFile(
      join(game, inis, 'humans', 'jobgraphics.cif'),
      buildMapCif([
        { level: 1, text: 'jobbasegraphics' },
        { level: 2, text: 'logictribe 1' },
        { level: 2, text: 'logicjob 6' },
        { level: 2, text: 'gfxbobmanagerbody 0 "Data\\Bobs\\Body00.bmd" "Data\\Bobs\\Body00_s.bmd"' },
        { level: 2, text: 'gfxbobmanagerhead 0 "Data\\Bobs\\Head00.bmd"' },
        { level: 2, text: 'gfxpalettebasebody "test_human_00"' },
        { level: 2, text: 'gfxpalettebasehead "test_human_00"' },
        // A second section name (jobchangegraphics) must not be picked up by the base extractor.
        { level: 1, text: 'jobchangegraphics' },
        { level: 2, text: 'logictribe 1' },
        { level: 2, text: 'gfxbobmanagerbody 0 "Data\\Bobs\\Body01.bmd"' },
      ]),
    );

    const { bindings } = await resolveGraphicsBindings(game, undefined);

    // Base animals binding first, then the flattened base-human body + head slots; the
    // jobchangegraphics body00 record is NOT emitted (different section name).
    expect(bindings.map((b) => [b.bmd, b.paletteName])).toEqual([
      ['data/bobs/lion.bmd', 'lion01'],
      ['data/bobs/body00.bmd', 'test_human_00'],
      ['data/bobs/head00.bmd', 'test_human_00'],
    ]);
    expect(bindings[1]?.shadowBmd).toBe('data/bobs/body00_s.bmd');
    expect(bindings[1]?.tribeId).toBe(1);
    expect(bindings[1]?.jobId).toBe(6);
  });

  it('merges the base-game vehicles/jobgraphics.cif [jobgraphics] cart/ship records (.cif-only leg)', async () => {
    const inis = join('Data', 'engine2d', 'inis');
    await mkdir(join(game, inis, 'animals'), { recursive: true });
    await mkdir(join(game, inis, 'vehicles'), { recursive: true });
    await writeFile(
      join(game, inis, 'animals', 'jobgraphics.ini'),
      '[jobgraphics]\ngfxbobmanagerbody "Data\\Bobs\\Lion.bmd"\ngfxpalettebody "Lion01"\n',
    );
    // Vehicles ship only as encrypted .cif; the flat [jobgraphics] grammar matches the animals .ini,
    // keyed by logicvehicle instead of logicjob (which is left undefined).
    await writeFile(
      join(game, inis, 'vehicles', 'jobgraphics.cif'),
      buildMapCif([
        { level: 1, text: 'jobgraphics' },
        { level: 2, text: 'logictribe 1' },
        { level: 2, text: 'logicvehicle 2' },
        { level: 2, text: 'gfxbobmanagerbody "Data\\Bobs\\Cart.bmd" "Data\\Bobs\\Cart_s.bmd"' },
        { level: 2, text: 'gfxpalettebody "OxCart"' },
      ]),
    );

    const { bindings } = await resolveGraphicsBindings(game, undefined);

    // Base animals binding first, then the flattened vehicle record.
    expect(bindings.map((b) => [b.bmd, b.paletteName])).toEqual([
      ['data/bobs/lion.bmd', 'lion01'],
      ['data/bobs/cart.bmd', 'oxcart'],
    ]);
    expect(bindings[1]?.shadowBmd).toBe('data/bobs/cart_s.bmd');
    expect(bindings[1]?.tribeId).toBe(1);
    // logicvehicle is not a job cross-ref, so jobId stays undefined.
    expect(bindings[1]?.jobId).toBeUndefined();
  });

  it('returns empty lists with a warning when a binding source is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { bindings, palettes } = await resolveGraphicsBindings(game, undefined); // nothing laid down

    expect(bindings).toEqual([]);
    expect(palettes).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/jobgraphics\.ini/));
    warn.mockRestore();
  });
});

describe('jobBaseGraphicsToBindings', () => {
  it('flattens body slots (bodyPalette) and head slots (headPalette) into flat bindings', () => {
    const flat = jobBaseGraphicsToBindings([
      {
        tribeId: 2,
        jobId: 4,
        body: [{ index: 0, bmd: 'data/bobs/body.bmd', shadowBmd: 'data/bobs/body_s.bmd' }],
        head: [
          { index: 0, bmd: 'data/bobs/head0.bmd', shadowBmd: undefined },
          { index: 1, bmd: 'data/bobs/head1.bmd', shadowBmd: undefined },
        ],
        bodyPalette: 'b_pal',
        headPalette: 'h_pal',
        randomPalette: 'rnd',
      },
    ]);

    expect(flat).toEqual([
      {
        bmd: 'data/bobs/body.bmd',
        shadowBmd: 'data/bobs/body_s.bmd',
        paletteName: 'b_pal',
        tribeId: 2,
        jobId: 4,
      },
      { bmd: 'data/bobs/head0.bmd', shadowBmd: undefined, paletteName: 'h_pal', tribeId: 2, jobId: 4 },
      { bmd: 'data/bobs/head1.bmd', shadowBmd: undefined, paletteName: 'h_pal', tribeId: 2, jobId: 4 },
    ]);
  });

  it('drops slots whose palette editname is absent (nothing to resolve against)', () => {
    const flat = jobBaseGraphicsToBindings([
      {
        tribeId: undefined,
        jobId: undefined,
        body: [{ index: 0, bmd: 'data/bobs/body.bmd', shadowBmd: undefined }],
        head: [{ index: 0, bmd: 'data/bobs/head.bmd', shadowBmd: undefined }],
        bodyPalette: 'b_pal', // body keeps its palette
        headPalette: undefined, // head has none -> dropped
        randomPalette: undefined,
      },
    ]);

    expect(flat).toEqual([
      {
        bmd: 'data/bobs/body.bmd',
        shadowBmd: undefined,
        paletteName: 'b_pal',
        tribeId: undefined,
        jobId: undefined,
      },
    ]);
  });
});

/**
 * IR-build wiring tests. We lay down synthetic `.ini` files at the real expected paths (base
 * `Data/logic/*`, mod `DataCnmd/*`) so the source-resolution + extract + validate path is exercised
 * without any copyrighted bytes — the grammar, not the game's data, is what's under test here.
 */
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
    const info = mapCifToInfo(buildMapCif(sampleMapLines()), 'tutorial_002', {
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
    root = await mkdtemp(join(tmpdir(), 'vinland-maps-'));
    game = join(root, 'game');
    await mkdir(join(game, 'CnModMaps', 'tutorial_002'), { recursive: true });
    await mkdir(join(game, 'CnModMaps', 'forteca'), { recursive: true });
    await writeFile(join(game, 'CnModMaps', 'tutorial_002', 'map.cif'), buildMapCif(sampleMapLines()));
    await writeFile(
      join(game, 'CnModMaps', 'forteca', 'map.cif'),
      buildMapCif([
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

describe('buildIr / resolveIniSources', () => {
  let game: string;

  beforeEach(async () => {
    const root = await mkdtemp(join(tmpdir(), 'vinland-ir-'));
    game = join(root, 'game');
    await mkdir(join(game, 'Data', 'logic'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'tribetypes12'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'atomicanimations12'), { recursive: true });
    await mkdir(join(game, 'DataCnmd', 'types'), { recursive: true });
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
    // Weapon wields jobType 3 (the [jobtype] above) so its cross-reference resolves.
    await writeFile(
      join(game, 'DataCnmd', 'types', 'weapons.ini'),
      '[weapontype]\ntribetype 1\ntype 2\nname "fist"\nminimumrange 1\nmaximumrange 1\ndamagevalue 0 400\njobtype 3\n',
    );
    await mkdir(join(game, 'CnModMaps', 'tutorial_002'), { recursive: true });
    await writeFile(join(game, 'CnModMaps', 'tutorial_002', 'map.cif'), buildMapCif(sampleMapLines()));
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
    expect(set.weapons.map((w) => w.id)).toEqual(['fist']);
    expect(set.weapons[0]).toMatchObject({ typeId: 2, tribeType: 1, jobType: 3, damage: { '0': 400 } });
    expect(set.weapons[0]?.source?.layer).toBe('mod');
    expect(set.landscape.map((l) => l.id)).toEqual(['grass']);
    expect(set.tribes.map((t) => t.id)).toEqual(['viking']);
    expect(set.atomicAnimations.map((a) => a.name)).toEqual(['viking_carry']);
    // The map.cif logic header is decoded into the IR alongside the .ini type tables.
    expect(set.maps.map((m) => m.id)).toEqual(['tutorial_002']);
    expect(set.maps[0]).toMatchObject({ width: 142, height: 146, mapType: 1 });
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
