import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFnt, type Font } from '../src/decoders/fnt.js';
import { decodePng } from '../src/decoders/png.js';
import { convertFontColorLut, convertFontStage, convertFonts } from '../src/stages/fonts.js';
import { sampleGlyphBmd } from './fixtures/bmd.js';
import { paletteCarrier } from './fixtures/pcx.js';

/**
 * Font stage tests. No copyrighted fixtures: we synthesize the `.fnt` files (a CFont wrapping a tiny `.bmd`)
 * at the real on-disk paths under a temp game dir — for the root + `latin/` + `rus/` sets — plus the four
 * `font_*.pcx` colour carriers, run each stage into a temp out dir, and assert the emitted atlases / colour
 * LUT / metrics + the top-level manifest. The per-decoder pixel/metric correctness is covered in the
 * fnt/atlas tests; here we assert the stage WIRING (right files at right paths, manifest shape, key scheme).
 */

/** A `.fnt` byte blob: a CFont with `value0C` (nominal size) around the sample glyph container. */
const sampleFont = (nominalSize: number): Uint8Array => {
  const font: Font = { version: 0, value08: 1, value0C: nominalSize, bmd: sampleGlyphBmd() };
  return encodeFnt(font);
};

const FONTS_DIR = join('Data', 'gui', 'fonts');
const PALETTES_DIR = join('Data', 'gui', 'palettes');
const BOBS_DIR = join('Data', 'engine2d', 'bin', 'bobs');
const FONTS_JSON_DIR = join('gui', 'fonts');

const FONT_STEMS = ['font08', 'font10', 'font12', 'fontdebug'];
const FONT_COLOR_FILES = ['font_white', 'font_dark', 'font_dimmed', 'font_red'];
/** stem → nominal size, so the metrics test can assert a per-font value carried through. */
const NOMINAL: Record<string, number> = { font08: 8, font10: 10, font12: 12, fontdebug: 8 };

describe('fonts stage', () => {
  let root: string;
  let game: string;
  let out: string;

  const writeGame = async (rel: string, bytes: Uint8Array): Promise<void> => {
    const path = join(game, rel);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, bytes);
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opennorthland-fonts-'));
    game = join(root, 'game');
    out = join(root, 'out');
    await mkdir(game, { recursive: true });
    // Colour carriers.
    for (const c of FONT_COLOR_FILES) await writeGame(join(PALETTES_DIR, `${c}.pcx`), paletteCarrier());
    // The three sets (root / latin / rus), each with the four sizes.
    for (const variantDir of ['', 'latin', 'rus']) {
      for (const stem of FONT_STEMS) {
        await writeGame(join(FONTS_DIR, variantDir, `${stem}.fnt`), sampleFont(NOMINAL[stem] ?? 0));
      }
    }
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('builds a 256×4 colour LUT with a stable row order and resolves the preview palettes', async () => {
    const res = await convertFontColorLut(game, out);
    expect(res.names).toEqual(['white', 'dark', 'dimmed', 'red']);
    expect(res.byName.get('white')).toHaveLength(768);
    const lut = decodePng(await readFile(join(out, BOBS_DIR, 'font-palettes-lut.png')));
    expect(lut.width).toBe(256);
    expect(lut.height).toBe(4); // one row per colour
  });

  it('keeps LUT rows stable (neutral fill) when a colour carrier is missing, with a warning', async () => {
    await rm(join(game, PALETTES_DIR, 'font_dark.pcx'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await convertFontColorLut(game, out);
    expect(res.names).toHaveLength(4); // row count unchanged despite the missing carrier
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/colour dark unreadable.*neutral row/));
    warn.mockRestore();
  });

  it('emits an indexed + preview atlas and a metrics JSON per font, keyed by variant', async () => {
    const { byName } = await convertFontColorLut(game, out);
    const fonts = await convertFonts(game, out, byName.get('white'));

    // 4 sizes × 3 sets = 12 fonts; the default set keeps the bare stem, variants get a prefix.
    expect(fonts).toHaveLength(12);
    const keys = fonts.map((f) => f.key);
    expect(keys).toContain('font10');
    expect(keys).toContain('latin_font10');
    expect(keys).toContain('rus_font10');

    const font10 = fonts.find((f) => f.key === 'font10');
    expect(font10?.indexedStem).toBe('font10.indexed');
    expect(font10?.previewStem).toBe('font10.white');
    expect(font10?.variant).toBe('default');
    expect(font10?.glyphs).toBe(2);

    // The indexed atlas + the colour preview both decode as valid RGBA sheets, and share the manifest geometry.
    const indexed = decodePng(await readFile(join(out, BOBS_DIR, 'font10.indexed.png')));
    const preview = decodePng(await readFile(join(out, BOBS_DIR, 'font10.white.png')));
    expect(indexed.width).toBe(preview.width);

    // The metrics JSON: self-describing + one glyph per bob in char order, nominal size carried through.
    const metrics = JSON.parse(await readFile(join(out, FONTS_JSON_DIR, 'font10.metrics.json'), 'utf8'));
    expect(metrics.key).toBe('font10');
    expect(metrics.variant).toBe('default');
    expect(metrics.firstChar).toBe(0x20);
    expect(metrics.charCount).toBe(2);
    expect(metrics.glyphs).toHaveLength(2);
    expect(metrics.glyphs[0].char).toBe(0x20);
    expect(metrics.nominalSize).toBe(10); // value0C of the font10 fixture
    expect(metrics.spaceBobId).toBe(0x49);
  });

  it('skips a missing/malformed .fnt with a warning instead of aborting', async () => {
    await rm(join(game, FONTS_DIR, 'font12.fnt')); // one root font gone
    await writeGame(join(FONTS_DIR, 'latin', 'font08.fnt'), Uint8Array.from([1, 2, 3, 4])); // one garbage font
    const { byName } = await convertFontColorLut(game, out);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fonts = await convertFonts(game, out, byName.get('white'));
    expect(fonts).toHaveLength(10); // 12 − the missing − the malformed
    expect(fonts.map((f) => f.key)).not.toContain('font12');
    expect(fonts.map((f) => f.key)).not.toContain('latin_font08');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped font12/));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped latin_font08/));
    warn.mockRestore();
  });

  it('ties everything together into content/gui/fonts/manifest.json', async () => {
    const summary = await convertFontStage(game, out);
    expect(summary).toMatchObject({ fonts: 12, colors: 4, glyphs: 24 });

    const manifest = JSON.parse(await readFile(join(out, FONTS_JSON_DIR, 'manifest.json'), 'utf8'));
    expect(manifest.fonts).toHaveLength(12);
    expect(manifest.colorLut.stem).toBe('font-palettes-lut');
    expect(manifest.colorLut.names).toEqual(['white', 'dark', 'dimmed', 'red']);
    // Metrics paths are forward-slash URL paths under /gui/ (never OS separators).
    for (const f of manifest.fonts) expect(f.metricsPath).toMatch(/^gui\/fonts\/.+\.metrics\.json$/);
  });
});
