import { type SpriteLayer, type TextureSource, loadAtlasSource } from '@vinland/render';
import { loadLayer } from './ir.js';

/**
 * Font (UI bitmap-font) content bindings — the loadable seam for the pipeline's `fonts` stage outputs, the
 * font twin of {@link import('./gui-gfx.js')}. No text is rendered yet; this module just makes the decoded
 * glyph atlases / colour LUT / metrics reachable so the HUD/text slice can consume them. Nothing here pulls
 * in copyrighted bytes — a checkout without `content/` degrades gracefully (a missing manifest/metrics return
 * `null`; a missing atlas throws `MissingAtlasError` via {@link loadLayer}, the same precondition the
 * settler/GUI loaders degrade on).
 *
 * Where each output lives (matching the pipeline stage + `vite.config.ts` routes):
 *  - **Glyph atlases + colour LUT** ride the existing `/bobs/` route (they are bob atlases): the recolourable
 *    **indexed** atlas at stem `<key>.indexed`, the RGBA **preview** at `<key>.white`, and the `256 × 4`
 *    colour LUT at `/bobs/font-palettes-lut.png` (loaded like the player/GUI LUTs). The renderer reads an
 *    indexed glyph pixel through the LUT row for the colour it draws text in — same mechanism as the
 *    player-colour LUT + `PalettedSprite`.
 *  - **Per-font metrics + the top-level manifest** are served at `/gui/fonts/…` (they are not bob atlases).
 */

/**
 * The font colour LUT row order (row index = colour). MIRRORS `FONT_COLORS` in
 * `tools/asset-pipeline/src/stages/fonts.ts` — keep the two in lock-step (append, never reorder), since the
 * pipeline bakes this order into the LUT rows and the renderer selects a row by index. The manifest also
 * carries the names, so a consumer can cross-check `fontColorRow` against `manifest.colorLut.names`.
 */
export const FONT_COLORS = ['white', 'dark', 'dimmed', 'red'] as const;

export type FontColorName = (typeof FONT_COLORS)[number];

/** The LUT row (y) a font colour occupies — the row a `PalettedSprite` reads an indexed glyph atlas through. */
export function fontColorRow(name: FontColorName): number {
  return FONT_COLORS.indexOf(name);
}

/** Path (relative to a `/bobs/` stem) of the recolourable indexed glyph atlas: `<key>.indexed`. */
export const INDEXED_FONT_SUFFIX = 'indexed';
/** The `/bobs/` stem of the font colour LUT PNG. */
export const FONT_COLOR_LUT_STEM = 'font-palettes-lut';

/** One glyph's layout metrics (mirrors the pipeline's `GlyphMetric`), keyed by character code. */
export interface GlyphMetric {
  readonly char: number;
  /** The bob (atlas frame) id to draw for this char: `char - firstChar`. */
  readonly bobId: number;
  /** Pen advance after drawing this glyph. */
  readonly advance: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly width: number;
  readonly height: number;
  /** True when the glyph draws no pixels (space, undefined chars). */
  readonly empty: boolean;
}

/** One font's full layout table (mirrors the pipeline's `FontMetrics` + the self-describing key/variant/stem). */
export interface FontMetrics {
  readonly key: string;
  readonly stem: string;
  readonly variant: string;
  /** First character code (0x20); glyph for char `c` is `glyphs[c - firstChar]`. */
  readonly firstChar: number;
  readonly charCount: number;
  /** The bob a space/tab is measured through (0x49). */
  readonly spaceBobId: number;
  readonly lineHeight: number;
  /** Derived baseline (advisory — the original lays out top-anchored via `offsetY` + `advance`). */
  readonly baseline: number;
  /** The font's nominal pixel size (an observation, not load-bearing). */
  readonly nominalSize: number;
  readonly glyphs: readonly GlyphMetric[];
}

/** One converted font as the pipeline's `content/gui/fonts/manifest.json` records it. */
export interface FontEntry {
  readonly key: string;
  readonly stem: string;
  readonly variant: string;
  /** `loadLayer` stem of the recolourable indexed glyph atlas. */
  readonly indexedStem: string;
  /** `loadLayer` stem of the default-coloured RGBA preview. */
  readonly previewStem: string;
  readonly previewColor: string;
  /** Path (relative to `/gui/`) of the per-font metrics JSON. */
  readonly metricsPath: string;
  readonly glyphs: number;
  readonly lineHeight: number;
  readonly baseline: number;
  readonly nominalSize: number;
}

/** The pipeline's top-level font manifest (`content/gui/fonts/manifest.json`) — the app's index of every font output. */
export interface FontManifest {
  readonly fonts: readonly FontEntry[];
  readonly colorLut: { readonly stem: string; readonly names: readonly string[] };
}

/** The served root for the font metric/manifest assets (atlases + LUT ride `/bobs/`). */
const FONTS_ROOT = '/gui/fonts';

/**
 * Load the top-level font manifest (`/gui/fonts/manifest.json`) — the single entry point that enumerates the
 * fonts (their atlas stems + metrics paths) and the colour LUT + its row names. Returns `null` when the
 * pipeline hasn't produced it (a checkout without `content/`), so a caller degrades gracefully.
 */
export async function loadFontManifest(): Promise<FontManifest | null> {
  try {
    const res = await fetch(`${FONTS_ROOT}/manifest.json`);
    if (!res.ok) return null;
    return (await res.json()) as FontManifest;
  } catch {
    return null;
  }
}

/**
 * The recolourable INDEXED glyph atlas of a font, loaded by its `<key>.indexed` stem through the shared
 * {@link loadLayer} — so font atlases go through the exact same manifest→geometry + PNG→texture path as the
 * settler/GUI atlases; the renderer reads each glyph pixel's index through the font colour LUT at draw time.
 * Throws `MissingAtlasError` when the decoded files are absent (the pipeline hasn't run). The RGBA preview
 * atlases load the same way — `loadLayer(previewStem)` off a {@link FontEntry} — so no separate preview loader
 * is needed.
 */
export function loadFontIndexed(key: string): Promise<SpriteLayer> {
  return loadLayer(`${key}.${INDEXED_FONT_SUFFIX}`);
}

/**
 * Load the font colour LUT texture (`/bobs/font-palettes-lut.png`, a `256 × 4` sheet, one composed colour
 * palette per row) the indexed glyph atlases are coloured through — the font twin of `loadGuiPaletteLut`.
 * Returns `undefined` when the pipeline hasn't produced it, so a caller degrades to the RGBA preview atlas.
 */
export async function loadFontColorLut(): Promise<TextureSource | undefined> {
  const url = `/bobs/${FONT_COLOR_LUT_STEM}.png`;
  const res = await fetch(url, { method: 'HEAD' });
  if (!res.ok) return undefined;
  return loadAtlasSource(url);
}

/**
 * Load one font's layout metrics (`/gui/fonts/<key>.metrics.json`) — the per-glyph advance/offset/size + line
 * height/baseline the renderer lays text out with. Returns `null` when the pipeline hasn't produced them (a
 * checkout without `content/`), so a caller can fall back gracefully instead of crashing.
 */
export async function loadFontMetrics(key: string): Promise<FontMetrics | null> {
  try {
    const res = await fetch(`${FONTS_ROOT}/${key}.metrics.json`);
    if (!res.ok) return null;
    return (await res.json()) as FontMetrics;
  } catch {
    return null;
  }
}
