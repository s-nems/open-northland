import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Bmd, BOB_TYPE_8BIT, encodeBmd, PACKED_X_SHIFT } from '../src/decoders/bmd.js';
import { encryptMode1, StorableId } from '../src/decoders/cif.js';
import { encodeCursor } from '../src/decoders/cursor.js';
import { encodePcx } from '../src/decoders/pcx.js';
import { decodePng } from '../src/decoders/png.js';
import {
  BODY_SHADOW_MIN_LUMA,
  convertCursors,
  convertGuiAtlases,
  convertGuiPaletteLut,
  convertGuiStage,
  convertGuiStrings,
  liftPaletteShadows,
} from '../src/stages/gui/index.js';

/**
 * GUI stage tests. No copyrighted fixtures: we synthesize the HUD sources (a `.bmd` bob sheet, palette
 * `.pcx` carriers, `ingamegui*.cif` string tables, and `.cur` cursors) at the real on-disk paths under a
 * temp game dir, run each stage into a temp out dir, and assert the emitted atlases/LUT/strings/cursors +
 * the top-level manifest. The per-decoder pixel correctness is covered in atlas/cursor/cif tests; here we
 * assert the stage WIRING (right files at right paths, manifest shape, CP1250 strings, hotspots).
 */

/** A 256-entry ramp palette (index i → (i, 255-i, (i*7)&0xff)) — every channel varies with the index. */
const ramp = (): Uint8Array => {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    p[i * 3] = i;
    p[i * 3 + 1] = 255 - i;
    p[i * 3 + 2] = (i * 7) & 0xff;
  }
  return p;
};

/** A 2×2 palette carrier (the shape the real `Data/gui/palettes/*.pcx` are: tiny image, 256-colour trailer). */
const paletteCarrier = (): Uint8Array =>
  encodePcx({ width: 2, height: 2, pixels: Uint8Array.from([0, 1, 2, 3]), palette: ramp() });

/** A 2-bob `.bmd` (both 8-bit, with pixels), serialized like a real CBobManager sheet. */
const sampleBmd = (): Uint8Array => {
  const bmd: Bmd = {
    version: 0,
    firstBobId: 0,
    bobCount: 2,
    generatedNonEmptyLines: 0,
    generatedEmptyLines: 0,
    generatedPackedLines: 0,
    bobs: [
      { type: BOB_TYPE_8BIT, area: { x: 0, y: 0, width: 2, height: 1 }, misc: 0 },
      { type: BOB_TYPE_8BIT, area: { x: 0, y: 0, width: 1, height: 1 }, misc: 1 },
    ],
    packedLineData: Uint8Array.from([0x02, 4, 8, 0x00, 0x01, 5, 0x00]),
    lineControl: Uint32Array.from([(0 << PACKED_X_SHIFT) | 0, (0 << PACKED_X_SHIFT) | 4]),
  };
  return encodeBmd(bmd);
};

/** Serializes a CStringArray `.cif` from level-tagged lines (the `[control]`/`[text]` grammar), encrypted like the original. */
const buildStringCif = (lines: readonly { level: number; text: string }[]): Uint8Array => {
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
  offsetValues.forEach((v, i) => {
    ov.setUint32(i * 4, v, true);
  });
  encryptMode1(offsets);
  encryptMode1(pool);

  const out: number[] = [];
  const pushU32 = (v: number): void =>
    void out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const pushCMemory = (data: Uint8Array): void => {
    pushU32(StorableId.CMemory);
    pushU32(0);
    pushU32(data.length);
    for (const b of data) out.push(b);
  };
  pushU32(StorableId.CStringArray);
  pushU32(0);
  pushU32(1); // forceSequentialIds
  pushU32(lines.length); // stringCount
  pushU32(lines.length); // usedIdCount
  pushU32(lines.length); // slotCount
  pushU32(pool.length); // stringPoolUsedBytes
  pushCMemory(offsets);
  out.push(1);
  pushCMemory(pool);
  return Uint8Array.from(out);
};

/** The palette carriers the LUT stacks (13 element palettes + the bubble palette), at their on-disk paths. */
const PALETTE_FILES = [
  join('Data', 'gui', 'palettes', 'iconsleft.pcx'),
  join('Data', 'gui', 'palettes', 'context.pcx'),
  join('Data', 'gui', 'palettes', 'frame.pcx'),
  join('Data', 'gui', 'palettes', 'bar_standart.pcx'),
  join('Data', 'gui', 'palettes', 'bar_hitpoints.pcx'),
  join('Data', 'gui', 'palettes', 'bar_disabled.pcx'),
  join('Data', 'gui', 'palettes', 'bg_normal.pcx'),
  join('Data', 'gui', 'palettes', 'bg_hilite.pcx'),
  join('Data', 'gui', 'palettes', 'bg_invert.pcx'),
  join('Data', 'gui', 'palettes', 'ingame_remap_01.pcx'),
  join('Data', 'gui', 'palettes', 'ingame_remap_02.pcx'),
  join('Data', 'gui', 'palettes', 'ingame_remap_03.pcx'),
  join('Data', 'gui', 'palettes', 'papyrus.pcx'),
  join('Data', 'engine2d', 'bin', 'palettes', 'gui', 'gui_bubbles.pcx'),
];

const STRING_TABLES = [
  'main',
  'misc',
  'miscwindow',
  'misclogic',
  'messages',
  'humanwindow',
  'humanlistwindow',
  'housewindow',
  'vehiclewindow',
];

const BOBS_DIR = join('Data', 'engine2d', 'bin', 'bobs');

describe('gui stage', () => {
  let root: string;
  let game: string;
  let out: string;

  const writeGame = async (rel: string, bytes: Uint8Array): Promise<void> => {
    const path = join(game, rel);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, bytes);
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'vinland-gui-'));
    game = join(root, 'game');
    out = join(root, 'out');
    await mkdir(game, { recursive: true });
    // Palettes.
    for (const f of PALETTE_FILES) await writeGame(f, paletteCarrier());
    // Bob sheets.
    await writeGame(join(BOBS_DIR, 'ls_gui_window.bmd'), sampleBmd());
    await writeGame(join(BOBS_DIR, 'ls_gui_bubbles.bmd'), sampleBmd());
    // Strings, both languages, in the real `[control]`/`[text]` grammar (`stringn` sets the id, `string`
    // auto-increments). `pol`'s first entry stores raw CP1250 BYTES (0xEA='ę', 0xB3='ł' in CP1250) as a
    // latin1 string, so the fixture round-trips a real Polish string through the stage's CP1250 re-decode.
    for (const lang of ['eng', 'pol']) {
      for (const table of STRING_TABLES) {
        await writeGame(
          join('Data', 'text', lang, 'strings', 'ingamegui', `ingamegui${table}.cif`),
          buildStringCif([
            { level: 1, text: 'control' },
            { level: 2, text: 'stringidmultiplier 1' },
            { level: 1, text: 'text' },
            { level: 2, text: lang === 'pol' ? 'stringn 0 "ê³"' : 'stringn 0 "Speed"' },
            { level: 2, text: lang === 'pol' ? 'string "Pauza"' : 'string "Pause"' },
          ]),
        );
      }
    }
    // Cursors (a 2×2 8-bpp image, hotspot (1,1)).
    for (const [name, hx, hy] of [
      ['MouseNormal', 1, 1],
      ['MousePressed', 1, 1],
      ['MouseRight', 10, 10],
    ] as const) {
      const cur = encodeCursor([
        {
          width: 2,
          height: 2,
          hotspotX: hx,
          hotspotY: hy,
          pixels: Uint8Array.from([1, 2, 3, 4]),
          palette: ramp(),
        },
      ]);
      await writeGame(join('DataX', 'Mouse', `${name}.cur`), cur);
    }
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('builds a 256×N palette LUT with a stable row order and resolves the preview palettes', async () => {
    const res = await convertGuiPaletteLut(game, out);
    expect(res.names).toHaveLength(14);
    expect(res.names[0]).toBe('iconsleft'); // row 0 is the default window preview palette
    expect(res.names.at(-1)).toBe('gui_bubbles');
    expect(res.byName.get('iconsleft')).toHaveLength(768);
    const lut = decodePng(await readFile(join(out, BOBS_DIR, 'gui-palettes-lut.png')));
    expect(lut.width).toBe(256);
    expect(lut.height).toBe(14); // one row per palette
  });

  it('keeps LUT rows stable (neutral fill) when a palette carrier is missing, with a warning', async () => {
    await rm(join(game, 'Data', 'gui', 'palettes', 'frame.pcx'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await convertGuiPaletteLut(game, out);
    expect(res.names).toHaveLength(14); // row count unchanged despite the missing carrier
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/palette frame unreadable.*neutral row/));
    warn.mockRestore();
  });

  it('emits an indexed + preview atlas (with manifest) per bob sheet under the /bobs tree', async () => {
    const { byName } = await convertGuiPaletteLut(game, out);
    const atlases = await convertGuiAtlases(game, out, byName);

    expect(atlases.map((a) => a.stem).sort()).toEqual(['ls_gui_bubbles', 'ls_gui_window']);
    const window = atlases.find((a) => a.stem === 'ls_gui_window');
    expect(window?.indexedStem).toBe('ls_gui_window.indexed');
    expect(window?.previewStem).toBe('ls_gui_window.iconsleft');
    expect(window?.frames).toBe(2);

    // Both the indexed atlas and the colour preview decode as valid RGBA sheets, and share the manifest.
    const indexed = decodePng(await readFile(join(out, BOBS_DIR, 'ls_gui_window.indexed.png')));
    const preview = decodePng(await readFile(join(out, BOBS_DIR, 'ls_gui_window.iconsleft.png')));
    expect(indexed.width).toBe(preview.width);
    const manifest = JSON.parse(
      await readFile(join(out, BOBS_DIR, 'ls_gui_window.indexed.atlas.json'), 'utf8'),
    );
    expect(manifest.frames).toHaveLength(2);
  });

  it('decodes the nine ingamegui tables per language, id→text, CP1250-decoded', async () => {
    const res = await convertGuiStrings(game, out);
    expect(res.map((r) => r.lang)).toEqual(['eng', 'pol']);
    expect(res.every((r) => r.tables === 9)).toBe(true);

    const eng = JSON.parse(await readFile(join(out, 'gui', 'strings', 'eng.json'), 'utf8'));
    expect(Object.keys(eng)).toHaveLength(9);
    expect(eng.main['0']).toBe('Speed'); // `stringn 0 "Speed"` → string-id 0
    expect(eng.main['1']).toBe('Pause'); // the following bare `string` auto-increments to id 1

    // The pol entry's raw bytes 0xEA/0xB3 must re-decode as CP1250 (ę/ł), not latin1 (ê/³).
    const pol = JSON.parse(await readFile(join(out, 'gui', 'strings', 'pol.json'), 'utf8'));
    expect(pol.main['0']).toBe('ęł');
  });

  it('drops only a malformed stringn line, not the bare strings that follow it', async () => {
    // A non-numeric `stringn` id must NOT poison the running id — otherwise every following bare `string`
    // (the shipped tables are long auto-incrementing runs) would be silently lost.
    await writeGame(
      join('Data', 'text', 'eng', 'strings', 'ingamegui', 'ingameguimain.cif'),
      buildStringCif([
        { level: 1, text: 'control' },
        { level: 2, text: 'stringidmultiplier 1' },
        { level: 1, text: 'text' },
        { level: 2, text: 'stringn zz "Bad"' }, // non-numeric id → this line dropped
        { level: 2, text: 'string "AfterBad"' }, // must still take id 0
        { level: 2, text: 'stringn 5 "Ok"' },
      ]),
    );
    await convertGuiStrings(game, out, ['eng']);
    const eng = JSON.parse(await readFile(join(out, 'gui', 'strings', 'eng.json'), 'utf8'));
    expect(eng.main['0']).toBe('AfterBad'); // survived — the bad stringn didn't NaN-poison the counter
    expect(eng.main['5']).toBe('Ok');
    expect(Object.values(eng.main)).not.toContain('Bad'); // only the malformed line itself is gone
  });

  it('decodes each cursor to a PNG, copies the .cur through, and records the hotspot', async () => {
    const cursors = await convertCursors(game, out);
    expect(cursors.map((c) => c.name)).toEqual(['MouseNormal', 'MousePressed', 'MouseRight']);
    const right = cursors.find((c) => c.name === 'MouseRight');
    expect([right?.hotspotX, right?.hotspotY]).toEqual([10, 10]);
    expect(right?.width).toBe(2);

    // The verbatim .cur and the decoded .png both landed under content/gui/cursors/.
    const png = decodePng(await readFile(join(out, 'gui', 'cursors', 'MouseNormal.png')));
    expect(png.width).toBe(2);
    expect((await readFile(join(out, 'gui', 'cursors', 'MouseNormal.cur'))).length).toBeGreaterThan(0);
  });

  it('ties everything together into content/gui/manifest.json', async () => {
    const summary = await convertGuiStage(game, out);
    expect(summary).toMatchObject({ atlases: 2, frames: 4, palettes: 14, cursors: 3 });

    const manifest = JSON.parse(await readFile(join(out, 'gui', 'manifest.json'), 'utf8'));
    expect(manifest.atlases).toHaveLength(2);
    expect(manifest.paletteLut.stem).toBe('gui-palettes-lut');
    expect(manifest.paletteLut.names).toHaveLength(14);
    expect(manifest.strings.languages).toEqual(['eng', 'pol']);
    expect(manifest.strings.tables).toHaveLength(9);
    expect(manifest.cursors).toHaveLength(3);
  });

  it('skips a missing bob sheet with a warning instead of aborting', async () => {
    await rm(join(game, BOBS_DIR, 'ls_gui_bubbles.bmd'));
    const { byName } = await convertGuiPaletteLut(game, out);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const atlases = await convertGuiAtlases(game, out, byName);
    expect(atlases.map((a) => a.stem)).toEqual(['ls_gui_window']); // the good one still converts
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped ls_gui_bubbles/));
    warn.mockRestore();
  });
});

/**
 * `liftPaletteShadows` arithmetic invariant (the window-body "cracked black" fix). This pins the pure
 * math — every entry ends at or above the near-black floor, entries already above the floor are untouched,
 * and hue is preserved on a mid entry — so the sampled-percentile intent can't silently regress; the actual
 * fidelity (does the wood match the original) stays a human visual call per plan step 3.
 */
describe('liftPaletteShadows', () => {
  const lumaOf = (p: Uint8Array, i: number): number => (p[i * 3] + p[i * 3 + 1] + p[i * 3 + 2]) / 3;

  it('lifts pure black to the near-black floor and leaves bright entries untouched', () => {
    const p = new Uint8Array(768); // entry 0 = black; entry 1 = a bright entry above the floor
    p[3] = 200;
    p[4] = 180;
    p[5] = 160;
    const lifted = liftPaletteShadows(p);
    expect(lumaOf(lifted, 0)).toBeCloseTo(BODY_SHADOW_MIN_LUMA, 0);
    expect([lifted[3], lifted[4], lifted[5]]).toEqual([200, 180, 160]); // above the floor: unchanged
  });

  it('lifts every near-black entry to at least the floor while keeping its own hue', () => {
    const p = new Uint8Array(768);
    // A dark brown entry (luma 8) below the floor but above the hue-noise threshold.
    p[0] = 12;
    p[1] = 8;
    p[2] = 4;
    const lifted = liftPaletteShadows(p);
    expect(lumaOf(lifted, 0)).toBeGreaterThanOrEqual(BODY_SHADOW_MIN_LUMA - 0.5);
    // Hue preserved: R > G > B ordering of the source is kept.
    expect(lifted[0]).toBeGreaterThan(lifted[1] as number);
    expect(lifted[1]).toBeGreaterThan(lifted[2] as number);
  });
});
