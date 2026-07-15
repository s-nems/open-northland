import { join } from 'node:path';
import { decodeFnt, type FontMetrics, fontMetrics } from '../decoders/fnt.js';
import {
  buildPaletteLut,
  emitIndexedAndPreviewAtlas,
  identityPalette,
  type PaletteLutResult,
  readGameFile,
  writeJsonFile,
} from './game-file.js';

/**
 * Font extraction stage — the original UI bitmap fonts (`Data/gui/fonts/*.fnt`), converted from an owned
 * game copy into `content/` so the renderer can draw text. It is the font twin of the GUI stage
 * ({@link import('./gui/index.js')}), reusing its pieces:
 *
 *  - **Glyph atlas.** Each `.fnt` is a CFont (id 0x3F5) wrapping the same CBobManager `.bmd` bob container
 *    the settlers/HUD use (one bob per glyph; char `c` → bob `c - 0x20`), so its bobs pack into the same
 *    atlas: an indexed atlas ({@link packIndexedBobAtlas} — palette index in red, mask in alpha) the
 *    renderer colours per text-colour at draw time through a colour LUT, plus an RGBA preview
 *    ({@link packBobAtlas}) coloured with the default (`white`) font palette for human inspection. Both ride
 *    the existing `/bobs/` route (`<stem>.png` + `<stem>.atlas.json`), loaded unchanged by `loadLayer`.
 *  - **Colours.** The engine colours glyphs with a `Data/gui/palettes/font_{white,dark,dimmed,red}.pcx`
 *    palette carrier. We stack them into one `256 × 4` LUT PNG — the same mechanism as the player-colour
 *    and GUI palette LUTs — with the row order fixed by {@link FONT_COLORS} (mirrored app-side in
 *    `packages/app/src/content/font-gfx.ts`). The renderer reads an indexed glyph pixel through the LUT row
 *    for its text colour.
 *  - **Metrics.** Per font, a `content/gui/fonts/<key>.metrics.json` carries the {@link FontMetrics}: the
 *    per-glyph advance/offset/size, line height, baseline, and space bob — the layout the renderer needs
 *    (the atlas gives where the pixels are; the metrics give how to lay them out). Metrics are
 *    derived from decoded font rectangles and pinned by synthetic layout tests.
 *
 * The three shipped sets — the root `Data/gui/fonts/` (the central-European set that carries the Polish
 * CP1250 glyph range) plus the `latin/` and `rus/` alternate-codepage variants — are all extracted, keyed
 * by variant (see {@link FONT_SOURCES}); the fonts are byte-indexed (`char = 0x20 + bobId`), so the codepage
 * a variant is read in belongs to the consuming language, not this decoder.
 *
 * Boundary failures are warned-and-skipped, never fatal (matching the other loose-file stages): a missing
 * `.fnt`/palette drops that one output rather than aborting the run. Everything lands under the gitignored
 * `content/`; no copyrighted bytes enter the repo.
 */

/** The `content/gui/fonts/` subtree the per-font metrics + manifest are written to (served at `/gui/fonts/`). */
const FONTS_CONTENT_DIR = join('gui', 'fonts');
/** Dir holding the `.fnt` files (root set); `latin/` and `rus/` variants live in sibling subdirs. */
const FONTS_DIR = join('Data', 'gui', 'fonts');
/** Dir holding the `font_*.pcx` colour palette carriers. */
const FONT_PALETTES_DIR = join('Data', 'gui', 'palettes');
/** Filename stem of the emitted `256 × 4` font-colour LUT (a `/bobs/` PNG, loaded like the player/GUI LUTs). */
export const FONT_COLOR_LUT_STEM = 'font-palettes-lut';
/** The colour a font's RGBA preview atlas is rendered in (the LUT's first row). */
export const DEFAULT_FONT_COLOR = 'white';

/** One font text colour: its LUT-row name and the `.pcx` carrier it is read from (under `gameDir`). */
interface FontColorSource {
  readonly name: string;
  readonly file: string;
}

/**
 * The font text colours, in LUT-row order (row index = array index). The renderer reads an indexed glyph
 * pixel through the row named here for the colour it draws text in. This order is the contract with the app
 * (mirrored in `packages/app/src/content/font-gfx.ts`) — append, never reorder, or the app's row indices drift.
 */
const FONT_COLORS: readonly FontColorSource[] = [
  { name: 'white', file: join(FONT_PALETTES_DIR, 'font_white.pcx') },
  { name: 'dark', file: join(FONT_PALETTES_DIR, 'font_dark.pcx') },
  { name: 'dimmed', file: join(FONT_PALETTES_DIR, 'font_dimmed.pcx') },
  { name: 'red', file: join(FONT_PALETTES_DIR, 'font_red.pcx') },
];

/** The four font sizes shipped in each set. */
const FONT_STEMS = ['font08', 'font10', 'font12', 'fontdebug'] as const;

/** A font set (codepage variant): its name and the subdir under {@link FONTS_DIR} (root set = `''`). */
interface FontVariant {
  readonly name: string;
  readonly dir: string;
}

/**
 * The shipped font sets. The root (`default`) set is the central-European one carrying the Polish CP1250
 * glyphs the UI needs; `latin` and `rus` are the alternate-codepage sets the original swaps in per language.
 */
const FONT_VARIANTS: readonly FontVariant[] = [
  { name: 'default', dir: '' },
  { name: 'latin', dir: 'latin' },
  { name: 'rus', dir: 'rus' },
];

/** One `.fnt` to extract: its output key + the size stem + the variant + the on-disk path (under `gameDir`). */
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
    file: join(FONTS_DIR, v.dir, `${stem}.fnt`),
  })),
);

/**
 * Reads every {@link FONT_COLORS} carrier, stacks their 256-colour trailers into one `256 × 4` LUT PNG (via
 * {@link buildPaletteLut}, the same mechanism as the player-colour / GUI palette LUTs), and writes it
 * under `BOBS_DIR`. A missing/palette-less carrier is warned and replaced with a neutral grayscale row
 * so the row order (the app's contract) stays fixed regardless of a partial install.
 */
export function convertFontColorLut(gameDir: string, outDir: string): Promise<PaletteLutResult> {
  return buildPaletteLut(gameDir, outDir, FONT_COLORS, FONT_COLOR_LUT_STEM, {
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
 * Decodes each `.fnt` into an indexed glyph atlas + an RGBA preview atlas (default colour) + a metrics JSON,
 * written under `BOBS_DIR` (atlases) and `content/gui/fonts/` (metrics). `previewPalette` supplies the
 * preview colours (from {@link convertFontColorLut}); an absent one falls back to a neutral palette so a
 * preview still renders. A missing/malformed `.fnt` warns-and-skips that font. Returns one {@link FontResult}
 * per font that converted, in {@link FONT_SOURCES} order.
 */
export async function convertFonts(
  gameDir: string,
  outDir: string,
  previewPalette: Uint8Array | undefined,
): Promise<FontResult[]> {
  const palette = previewPalette ?? identityPalette();
  const done: FontResult[] = [];
  for (const src of FONT_SOURCES) {
    let bytes: Uint8Array;
    try {
      bytes = await readGameFile(gameDir, src.file);
    } catch (err) {
      console.warn(`[pipeline] fonts: skipped ${src.key}: ${(err as Error).message}`);
      continue;
    }
    // decode + metrics + atlas emit share one warn-and-skip guard so a malformed-but-decodable font
    // drops only itself, never aborting the batch (matching the goods/GUI stages).
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
      console.warn(`[pipeline] fonts: skipped ${src.key}: ${(err as Error).message}`);
      continue;
    }

    const metricsPath = join(FONTS_CONTENT_DIR, `${src.key}.metrics.json`);
    const metricsFile: FontMetricsFile = { key: src.key, stem: src.stem, variant: src.variant, ...metrics };
    await writeJsonFile(outDir, metricsPath, metricsFile);

    done.push({
      key: src.key,
      stem: src.stem,
      variant: src.variant,
      indexedStem,
      previewStem,
      previewColor: DEFAULT_FONT_COLOR,
      // The manifest records a forward-slash URL path (a browser fetches `/gui/fonts/<key>.metrics.json`),
      // so it must not carry OS separators.
      metricsPath: metricsPath.split(/[\\/]/).join('/'),
      glyphs: metrics.charCount,
      lineHeight: metrics.lineHeight,
      baseline: metrics.baseline,
      nominalSize: metrics.nominalSize,
    });
  }
  return done;
}

/** The top-level `content/gui/fonts/manifest.json` — the app's single entry point to discover every font output. */
export interface FontManifest {
  readonly fonts: FontResult[];
  readonly colorLut: { readonly stem: string; readonly names: string[] };
}

/** What {@link convertFontStage} did, for the CLI log line. */
export interface FontStageSummary {
  readonly fonts: number;
  readonly glyphs: number;
  readonly colors: number;
}

/**
 * Runs the whole font extraction: colour LUT (which also yields the preview palettes) → per-font indexed +
 * preview atlases + metrics → the top-level `content/gui/fonts/manifest.json`. Returns a summary for the CLI
 * log. Each sub-step is independently resilient (warn-and-skip), so a partial game install still produces
 * whatever it can.
 */
export async function convertFontStage(gameDir: string, outDir: string): Promise<FontStageSummary> {
  const colors = await convertFontColorLut(gameDir, outDir);
  const fonts = await convertFonts(gameDir, outDir, colors.byName.get(DEFAULT_FONT_COLOR));

  const manifest: FontManifest = {
    fonts,
    colorLut: { stem: colors.stem, names: colors.names },
  };
  await writeJsonFile(outDir, join(FONTS_CONTENT_DIR, 'manifest.json'), manifest);

  return {
    fonts: fonts.length,
    glyphs: fonts.reduce((sum, f) => sum + f.glyphs, 0),
    colors: colors.names.length,
  };
}
