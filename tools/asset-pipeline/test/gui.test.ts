import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeBmd } from '../src/decoders/bmd/index.js';
import { encodeCursor } from '../src/decoders/cur.js';
import { decodePng } from '../src/decoders/png.js';
import { MOD_BOBS_DIR } from '../src/roots.js';
import { BOBS_DIR } from '../src/stages/content-tree.js';
import {
  BODY_SHADOW_MIN_LUMA,
  convertCursors,
  convertGuiAtlases,
  convertGuiPaletteLut,
  convertGuiStage,
  convertGuiStrings,
  liftPaletteShadows,
} from '../src/stages/gui/index.js';
import { EXPORTED_TABLES, GAME_OBJECT_TABLES, STRING_TABLES } from '../src/stages/gui/strings.js';
import { sampleGlyphBmd } from './fixtures/bmd.js';
import { buildStringCif } from './fixtures/cif.js';
import { rampPalette } from './fixtures/palette.js';
import { paletteCarrier } from './fixtures/pcx.js';
import { type GameOutTemp, makeGameOutTemp } from './support/game-tree.js';

/**
 * GUI stage tests. No copyrighted fixtures: we synthesize the HUD sources (a `.bmd` bob sheet, palette
 * `.pcx` carriers, `ingamegui*.cif` string tables, and `.cur` cursors) at the real on-disk paths under a
 * temp game dir, run each stage into a temp out dir, and assert the emitted atlases/LUT/strings/cursors +
 * the top-level manifest. The per-decoder pixel correctness is covered in atlas/cursor/cif tests; here we
 * assert the stage WIRING (right files at right paths, manifest shape, CP1250 strings, hotspots).
 */

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

describe('gui stage', () => {
  let game: string;
  let out: string;
  let writeGame: GameOutTemp['write'];
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ game, out, write: writeGame, cleanup } = await makeGameOutTemp('gui'));
    // Palettes.
    for (const f of PALETTE_FILES) await writeGame(f, paletteCarrier());
    // Bob sheets.
    await writeGame(join(MOD_BOBS_DIR, 'ls_gui_window.bmd'), encodeBmd(sampleGlyphBmd()));
    await writeGame(join(MOD_BOBS_DIR, 'ls_gui_bubbles.bmd'), encodeBmd(sampleGlyphBmd()));
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
          palette: rampPalette(),
        },
      ]);
      await writeGame(join('DataX', 'Mouse', `${name}.cur`), cur);
    }
  });

  afterEach(async () => {
    await cleanup();
  });

  it('builds a 256×N palette LUT with a stable row order and resolves the preview palettes', async () => {
    const res = await convertGuiPaletteLut({ mod: game }, out);
    expect(res.names).toHaveLength(14);
    expect(res.names[0]).toBe('iconsleft'); // row 0 is the default window preview palette
    expect(res.names.at(-1)).toBe('gui_bubbles');
    expect(res.byName.get('iconsleft')).toHaveLength(768);
    const lut = await decodePng(await readFile(join(out, BOBS_DIR, 'gui-palettes-lut.png')));
    expect(lut.width).toBe(256);
    expect(lut.height).toBe(14); // one row per palette
  });

  it('keeps LUT rows stable (neutral fill) when a palette carrier is missing, with a warning', async () => {
    await rm(join(game, 'Data', 'gui', 'palettes', 'frame.pcx'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await convertGuiPaletteLut({ mod: game }, out);
    expect(res.names).toHaveLength(14); // row count unchanged despite the missing carrier
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/palette frame unreadable.*neutral row/));
    warn.mockRestore();
  });

  it('emits an indexed + preview atlas (with manifest) per bob sheet under the /bobs tree', async () => {
    const { byName } = await convertGuiPaletteLut({ mod: game }, out);
    const atlases = await convertGuiAtlases({ mod: game }, out, byName);

    expect(atlases.map((a) => a.stem).sort()).toEqual(['ls_gui_bubbles', 'ls_gui_window']);
    const window = atlases.find((a) => a.stem === 'ls_gui_window');
    expect(window?.indexedStem).toBe('ls_gui_window.indexed');
    expect(window?.previewStem).toBe('ls_gui_window.iconsleft');
    expect(window?.frames).toBe(2);

    // Both the indexed atlas and the colour preview decode as valid RGBA sheets, and share the manifest.
    const indexed = await decodePng(await readFile(join(out, BOBS_DIR, 'ls_gui_window.indexed.png')));
    const preview = await decodePng(await readFile(join(out, BOBS_DIR, 'ls_gui_window.iconsleft.png')));
    expect(indexed.width).toBe(preview.width);
    const manifest = JSON.parse(
      await readFile(join(out, BOBS_DIR, 'ls_gui_window.indexed.atlas.json'), 'utf8'),
    );
    expect(manifest.frames).toHaveLength(2);
  });

  it('decodes the eight ingamegui tables per language, id→text, CP1250-decoded', async () => {
    const res = await convertGuiStrings({ mod: game }, out);
    expect(res.map((r) => r.lang)).toEqual(['eng', 'pol']);
    expect(res.every((r) => r.tables === 8)).toBe(true);

    const eng = JSON.parse(await readFile(join(out, 'gui', 'strings', 'eng.json'), 'utf8'));
    expect(Object.keys(eng)).toHaveLength(8);
    expect(eng.main['0']).toBe('Speed'); // `stringn 0 "Speed"` → string-id 0
    expect(eng.main['1']).toBe('Pause'); // the following bare `string` auto-increments to id 1

    // The pol entry's raw bytes 0xEA/0xB3 must re-decode as CP1250 (ę/ł), not latin1 (ê/³).
    const pol = JSON.parse(await readFile(join(out, 'gui', 'strings', 'pol.json'), 'utf8'));
    expect(pol.main['0']).toBe('ęł');
  });

  it('drops only a malformed stringn line, not the bare strings that follow it', async () => {
    // A non-numeric `stringn` id must NOT poison the running id - otherwise every following bare `string`
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
    await convertGuiStrings({ mod: game }, out, ['eng']);
    const eng = JSON.parse(await readFile(join(out, 'gui', 'strings', 'eng.json'), 'utf8'));
    expect(eng.main['0']).toBe('AfterBad'); // survived - the bad stringn didn't NaN-poison the counter
    expect(eng.main['5']).toBe('Ok');
    expect(Object.values(eng.main)).not.toContain('Bad'); // only the malformed line itself is gone
  });

  it('decodes the five game-object tables by type id, preferring a readable .ini over the .cif', async () => {
    // `stringidmultiplier 2` and the bare plural rows must not move or add ids: the key is the `stringn` id.
    const rows = (singular: string): string =>
      `[control]\nstringidmultiplier 2\n[text]\nstringn 3 "${singular}"\nstring "plural"\n`;
    for (const table of GAME_OBJECT_TABLES) {
      await writeGame(
        join('Data', 'text', 'eng', 'strings', 'gameobjects', `${table}.cif`),
        buildStringCif([
          { level: 1, text: 'text' },
          { level: 2, text: `stringn 3 "${table} cif"` },
          { level: 2, text: 'string "plural"' },
        ]),
      );
      // Raw CP1250 bytes for 'ą' (0xB9), so the .ini is decoded in the language's code page.
      await writeGame(
        join('Data', 'text', 'pol', 'strings', 'gameobjects', `${table}.ini`),
        Buffer.from(rows(`${table} \xb9`), 'latin1'),
      );
    }
    await writeGame(
      join('Data', 'text', 'eng', 'strings', 'gameobjects', 'houses.ini'),
      Buffer.from(rows('houses ini'), 'latin1'),
    );

    const res = await convertGuiStrings({ mod: game }, out);
    expect(res.every((r) => r.tables === EXPORTED_TABLES.length)).toBe(true);
    const eng = JSON.parse(await readFile(join(out, 'gui', 'strings', 'eng.json'), 'utf8'));
    const pol = JSON.parse(await readFile(join(out, 'gui', 'strings', 'pol.json'), 'utf8'));
    for (const table of GAME_OBJECT_TABLES) {
      expect(eng[table]).toEqual({ 3: table === 'houses' ? 'houses ini' : `${table} cif` });
      expect(pol[table]).toEqual({ 3: `${table} ą` });
    }
    expect(eng.jobsPlural).toEqual({ 3: 'plural' });
    expect(pol.jobsPlural).toEqual({ 3: 'plural' });
    expect(eng).not.toHaveProperty('goodsPlural');
  });

  it('exports the jobs plurals from the string row after each stringn, in .ini and .cif alike', async () => {
    // Raw CP1250 bytes for 'ś' (0x9C) in the .ini, raw CP1251 for 'Ж' (0xC6) in the .cif.
    await writeGame(
      join('Data', 'text', 'pol', 'strings', 'gameobjects', 'jobs.ini'),
      Buffer.from(
        '[text]\nstringn 9 "Cie\x9cla"\nstring "Cie\x9cle"\nstringn 4 "Bez"\nstringn 5 "Nowy"\n',
        'latin1',
      ),
    );
    await writeGame(
      join('Data', 'text', 'rus', 'strings', 'gameobjects', 'jobs.cif'),
      buildStringCif([
        { level: 1, text: 'text' },
        { level: 2, text: 'stringn 9 "\xc6"' },
        { level: 2, text: 'string "\xc6\xc6"' },
        { level: 2, text: 'stringn zz "Bad"' },
        { level: 2, text: 'string "orphan"' },
      ]),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await convertGuiStrings({ mod: game }, out, ['pol', 'rus']);
    warn.mockRestore();
    const pol = JSON.parse(await readFile(join(out, 'gui', 'strings', 'pol.json'), 'utf8'));
    const rus = JSON.parse(await readFile(join(out, 'gui', 'strings', 'rus.json'), 'utf8'));
    expect(pol.jobs).toEqual({ 9: 'Cieśla', 4: 'Bez', 5: 'Nowy' });
    // A stringn with no string row after it has no plural.
    expect(pol.jobsPlural).toEqual({ 9: 'Cieśle' });
    // The plural of a malformed stringn goes with it.
    expect(rus.jobsPlural).toEqual({ 9: 'ЖЖ' });
  });

  it('trims game-object names and collapses their runs of spaces before corrections read them', async () => {
    await writeGame(
      join('Data', 'text', 'eng', 'strings', 'gameobjects', 'goods.cif'),
      buildStringCif([
        { level: 1, text: 'text' },
        { level: 2, text: 'stringn 46 "Small  Potion "' },
        { level: 2, text: 'string " Small   Potions"' },
      ]),
    );
    await writeGame(
      join('Data', 'text', 'eng', 'strings', 'gameobjects', 'jobs.ini'),
      Buffer.from('[text]\nstringn 2 "  Wood   Cutter "\nstring "Wood  Cutters  "\n', 'latin1'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await convertGuiStrings({ mod: game }, out, ['eng']);
    warn.mockRestore();
    const eng = JSON.parse(await readFile(join(out, 'gui', 'strings', 'eng.json'), 'utf8'));
    expect(eng.goods).toEqual({ 46: 'Small Potion' });
    expect(eng.jobs).toEqual({ 2: 'Wood Cutter' });
    expect(eng.jobsPlural).toEqual({ 2: 'Wood Cutters' });
  });

  it('skips a missing game-object table with a warning and keeps the rest', async () => {
    await writeGame(
      join('Data', 'text', 'eng', 'strings', 'gameobjects', 'goods.ini'),
      Buffer.from('[text]\nstringn 1 "Wood"\n', 'latin1'),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await convertGuiStrings({ mod: game }, out, ['eng']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped strings eng\/houses/));
    warn.mockRestore();
    expect(res[0]?.tables).toBe(STRING_TABLES.length + 1);
    const eng = JSON.parse(await readFile(join(out, 'gui', 'strings', 'eng.json'), 'utf8'));
    expect(eng.goods).toEqual({ 1: 'Wood' });
    expect(eng).not.toHaveProperty('houses');
  });

  it('decodes each cursor to a PNG, copies the .cur through, and records the hotspot', async () => {
    const cursors = await convertCursors({ mod: game }, out);
    expect(cursors.map((c) => c.name)).toEqual(['MouseNormal', 'MousePressed', 'MouseRight']);
    const right = cursors.find((c) => c.name === 'MouseRight');
    expect([right?.hotspotX, right?.hotspotY]).toEqual([10, 10]);
    expect(right?.width).toBe(2);

    // The verbatim .cur and the decoded .png both landed under content/gui/cursors/.
    const png = await decodePng(await readFile(join(out, 'gui', 'cursors', 'MouseNormal.png')));
    expect(png.width).toBe(2);
    expect((await readFile(join(out, 'gui', 'cursors', 'MouseNormal.cur'))).length).toBeGreaterThan(0);
  });

  it('ties everything together into content/gui/manifest.json', async () => {
    const summary = await convertGuiStage({ mod: game }, out);
    expect(summary).toMatchObject({ atlases: 2, frames: 4, palettes: 14, cursors: 3 });

    const manifest = JSON.parse(await readFile(join(out, 'gui', 'manifest.json'), 'utf8'));
    expect(manifest.atlases).toHaveLength(2);
    expect(manifest.paletteLut.stem).toBe('gui-palettes-lut');
    expect(manifest.paletteLut.names).toHaveLength(14);
    expect(manifest.strings.languages).toEqual(['eng', 'pol']);
    expect(manifest.strings.tables).toEqual([...STRING_TABLES, ...GAME_OBJECT_TABLES, 'jobsPlural']);
    expect(manifest.history.languages).toEqual([]); // no hypertext/history folder in this fixture
    expect(manifest.cursors).toHaveLength(3);
  });

  it('skips a missing bob sheet with a warning instead of aborting', async () => {
    await rm(join(game, MOD_BOBS_DIR, 'ls_gui_bubbles.bmd'));
    const { byName } = await convertGuiPaletteLut({ mod: game }, out);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const atlases = await convertGuiAtlases({ mod: game }, out, byName);
    expect(atlases.map((a) => a.stem)).toEqual(['ls_gui_window']); // the good one still converts
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped ls_gui_bubbles/));
    warn.mockRestore();
  });
});

/**
 * `liftPaletteShadows` arithmetic invariant (the window-body "cracked black" fix). This pins the pure
 * math - every entry ends at or above the near-black floor, entries already above the floor are untouched,
 * and hue is preserved on a mid entry - so the sampled-percentile intent can't silently regress; the actual
 * fidelity (does the wood match the original) stays a human visual call per plan step 3.
 */
describe('liftPaletteShadows', () => {
  const lumaOf = (p: Uint8Array, i: number): number => {
    const r = p[i * 3];
    const g = p[i * 3 + 1];
    const b = p[i * 3 + 2];
    if (r === undefined || g === undefined || b === undefined) throw new Error(`missing palette entry ${i}`);
    return (r + g + b) / 3;
  };

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
