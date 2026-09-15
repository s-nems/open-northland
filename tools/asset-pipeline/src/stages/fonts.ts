import { decodeFnt } from '../decoders/fnt/codec.js';
import { type FontMetrics, fontMetrics } from '../decoders/fnt/metrics.js';
import { errorMessage } from '../errors.js';
import type { SourceRoots } from '../roots.js';
import { emitIndexedAndPreviewAtlas, writeJsonFile } from './content-tree.js';
import { buildPaletteLut, identityPalette, type PaletteLutResult } from './palette-lut.js';
import { readSourceFile } from './source-files.js';

/** Per-font metrics and manifest land here, served at `/gui/fonts/`. */
const FONTS_CONTENT_DIR = 'gui/fonts';
/** The root font set; the `latin/` and `rus/` variants live in sibling subdirs. */
const FONTS_DIR = 'Data/gui/fonts';
/** Dir holding the `font_*.pcx` colour palette carriers. */
const FONT_PALETTES_DIR = 'Data/gui/palettes';
/** Stem of the emitted `256 x 4` font-colour LUT PNG, served at `/bobs/`. */
export const FONT_COLOR_LUT_STEM = 'font-palettes-lut';
/** The colour a font's RGBA preview atlas is rendered in (the LUT's first row). */
export const DEFAULT_FONT_COLOR = 'white';

/** One font text colour: its LUT-row name and the `.pcx` carrier it is read from (under `roots`). */
interface FontColorSource {
  readonly name: string;
  readonly file: string;
}

/**
 * The font text colours, in LUT-row order (row index = array index). The order is mirrored in
 * `packages/app/src/content/font-gfx.ts`: append, never reorder, or the app's row indices drift.
 */
const FONT_COLORS: readonly FontColorSource[] = [
  { name: 'white', file: `${FONT_PALETTES_DIR}/font_white.pcx` },
  { name: 'dark', file: `${FONT_PALETTES_DIR}/font_dark.pcx` },
  { name: 'dimmed', file: `${FONT_PALETTES_DIR}/font_dimmed.pcx` },
  { name: 'red', file: `${FONT_PALETTES_DIR}/font_red.pcx` },
];

/** The four font sizes shipped in each set. */
const FONT_STEMS = ['font08', 'font10', 'font12', 'fontdebug'] as const;

/** A font set (codepage variant): its name and the subdir under `FONTS_DIR` (root set = `''`). */
interface FontVariant {
  readonly name: string;
  readonly dir: string;
}

/**
 * The shipped font sets. The root (`default`) set carries the central-European CP1250 glyphs; `latin`
 * and `rus` are the alternate-codepage sets the original swaps in per language.
 */
const FONT_VARIANTS: readonly FontVariant[] = [
  { name: 'default', dir: '' },
  { name: 'latin', dir: 'latin' },
  { name: 'rus', dir: 'rus' },
];

/** One `.fnt` to extract: its output key + the size stem + the variant + the on-disk path (under `roots`). */
interface FontSource {
  /** Flat output key / atlas-stem base: the stem for the default set, `<variant>_<stem>` otherwise. */
  readonly key: string;
  readonly stem: string;
  readonly variant: string;
  readonly file: string;
}

/** Every `.fnt` across the three sets, in a stable (variant, size) order. */
const FONT_SOURCES: readonly FontSource[] = FONT_VARIANTS.flatMap((v) =>
  FONT_STEMS.map((stem) => ({
    key: v.name === 'default' ? stem : `${v.name}_${stem}`,
    stem,
    variant: v.name,
    file: `${FONTS_DIR}/${v.dir}/${stem}.fnt`,
  })),
);

/** Stacks the {@link FONT_COLORS} carriers' 256-colour trailers into one `256 x 4` LUT PNG. */
export function convertFontColorLut(roots: SourceRoots, outDir: string): Promise<PaletteLutResult> {
  return buildPaletteLut(roots, outDir, FONT_COLORS, FONT_COLOR_LUT_STEM, {
    label: 'fonts',
    noun: 'colour',
  });
}

/** One converted font: its atlas stems, metrics path, and the font-wide layout numbers (for the manifest). */
export interface FontResult {
  /** Flat output key (`font10`, `latin_font10`, …). */
  readonly key: string;
  /** Font size stem (`font10`) and codepage variant (`default`/`latin`/`rus`). */
  readonly stem: string;
  readonly variant: string;
  /** `loadLayer` stem for the recolourable indexed glyph atlas (`<key>.indexed`). */
  readonly indexedStem: string;
  /** `loadLayer` stem for the default-coloured RGBA preview (`<key>.<DEFAULT_FONT_COLOR>`). */
  readonly previewStem: string;
  readonly previewColor: string;
  /** Path under `content/` (served at `/gui/fonts/<key>.metrics.json`) of the layout metrics. */
  readonly metricsPath: string;
  /** Number of glyphs (characters `0x20 .. 0x20 + glyphs - 1`). */
  readonly glyphs: number;
  readonly lineHeight: number;
  readonly baseline: number;
  readonly nominalSize: number;
}

/** The per-font metrics JSON body: the {@link FontMetrics} plus self-describing key/variant/stem fields. */
interface FontMetricsFile extends FontMetrics {
  readonly key: string;
  readonly stem: string;
  readonly variant: string;
}

/**
 * Decodes each `.fnt` into an indexed glyph atlas, an RGBA preview atlas, and a metrics JSON. An absent
 * `previewPalette` falls back to a neutral palette; a missing or malformed `.fnt` warns and skips that
 * font. Results follow {@link FONT_SOURCES} order.
 */
export async function convertFonts(
  roots: SourceRoots,
  outDir: string,
  previewPalette: Uint8Array | undefined,
): Promise<FontResult[]> {
  const palette = previewPalette ?? identityPalette();
  const done: FontResult[] = [];
  for (const src of FONT_SOURCES) {
    let bytes: Uint8Array;
    try {
      bytes = await readSourceFile(roots, src.file);
    } catch (err) {
      console.warn(`[pipeline] fonts: skipped ${src.key}: ${errorMessage(err)}`);
      continue;
    }
    let metrics: FontMetrics;
    let indexedStem: string;
    let previewStem: string;
    try {
      const font = decodeFnt(bytes);
      metrics = fontMetrics(font);
      ({ indexedStem, previewStem } = await emitIndexedAndPreviewAtlas(
        outDir,
        src.key,
        font.bmd,
        DEFAULT_FONT_COLOR,
        palette,
      ));
    } catch (err) {
      console.warn(`[pipeline] fonts: skipped ${src.key}: ${errorMessage(err)}`);
      continue;
    }

    const metricsPath = `${FONTS_CONTENT_DIR}/${src.key}.metrics.json`;
    const metricsFile: FontMetricsFile = { key: src.key, stem: src.stem, variant: src.variant, ...metrics };
    await writeJsonFile(outDir, metricsPath, metricsFile);

    done.push({
      key: src.key,
      stem: src.stem,
      variant: src.variant,
      indexedStem,
      previewStem,
      previewColor: DEFAULT_FONT_COLOR,
      metricsPath,
      glyphs: metrics.charCount,
      lineHeight: metrics.lineHeight,
      baseline: metrics.baseline,
      nominalSize: metrics.nominalSize,
    });
  }
  return done;
}

/** Body of `content/gui/fonts/manifest.json`, the app's entry point to every font output. */
export interface FontManifest {
  readonly fonts: FontResult[];
  readonly colorLut: { readonly stem: string; readonly names: string[] };
}

export interface FontStageSummary {
  readonly fonts: number;
  readonly glyphs: number;
  readonly colors: number;
}

/** Runs the font extraction end to end; each sub-step warns and skips, so a partial install still converts. */
export async function convertFontStage(roots: SourceRoots, outDir: string): Promise<FontStageSummary> {
  const colors = await convertFontColorLut(roots, outDir);
  const fonts = await convertFonts(roots, outDir, colors.byName.get(DEFAULT_FONT_COLOR));

  const manifest: FontManifest = {
    fonts,
    colorLut: { stem: colors.stem, names: colors.names },
  };
  await writeJsonFile(outDir, `${FONTS_CONTENT_DIR}/manifest.json`, manifest);

  return {
    fonts: fonts.length,
    glyphs: fonts.reduce((sum, f) => sum + f.glyphs, 0),
    colors: colors.names.length,
  };
}
