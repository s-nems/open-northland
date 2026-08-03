import type { SpriteLayer, TextureSource } from '@open-northland/render';
import { loadLayer } from './ir/load.js';
import { fetchJsonOrNull, loadTextureIfPresent } from './net.js';

/**
 * Bitmap-font content bindings for the pipeline's `fonts` stage outputs. Glyph atlases and the colour LUT
 * ride the `/bobs/` route; per-font metrics and the manifest are served at `/gui/fonts/`. A checkout
 * without `content/` degrades: missing metrics return `null`, a missing atlas throws `MissingAtlasError`.
 */

/**
 * The font colour LUT row order (row index = colour). Append, never reorder: the pipeline bakes this order
 * into the LUT rows (`stages/fonts.ts`) and the renderer selects a row by index.
 */
const FONT_COLORS = ['white', 'dark', 'dimmed', 'red'] as const;

export type FontColorName = (typeof FONT_COLORS)[number];

/** The LUT row a `PalettedSprite` reads an indexed glyph atlas through. */
export function fontColorRow(name: FontColorName): number {
  return FONT_COLORS.indexOf(name);
}

/**
 * CSS fill strings approximating the four font-colour LUT rows, for text a CSS `fill` draws without
 * sampling the indexed palette. A named colour choice sampled to sit on the wood and parchment chrome the
 * way the original's `font_*` palettes do, not decoded palette bytes, so it can drift from the LUT.
 */
export const FONT_FILL: Readonly<Record<FontColorName, string>> = {
  white: '#f2ead6',
  dark: '#2a2118',
  dimmed: '#9a8f78',
  red: '#c8503c',
};

/** Path (relative to a `/bobs/` stem) of the recolourable indexed glyph atlas: `<key>.indexed`. */
const INDEXED_FONT_SUFFIX = 'indexed';
/** The `/bobs/` stem of the font colour LUT PNG. */
const FONT_COLOR_LUT_STEM = 'font-palettes-lut';

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
  /** Derived baseline (advisory - the original lays out top-anchored via `offsetY` + `advance`). */
  readonly baseline: number;
  /** The font's nominal pixel size (an observation, not load-bearing). */
  readonly nominalSize: number;
  readonly glyphs: readonly GlyphMetric[];
}

/** The served root for the font metric assets (atlases + LUT ride `/bobs/`). */
const FONTS_ROOT = '/gui/fonts';

/**
 * The recolourable indexed glyph atlas of a font. Throws `MissingAtlasError` when the decoded files are
 * absent. An RGBA preview atlas loads the same way as `loadLayer('<key>.white')`.
 */
export function loadFontIndexed(key: string): Promise<SpriteLayer> {
  return loadLayer(`${key}.${INDEXED_FONT_SUFFIX}`);
}

/**
 * The font colour LUT texture (a `256 × 4` sheet, one composed palette per row) the indexed glyph atlases
 * are coloured through. `undefined` when the pipeline hasn't produced it, so a caller degrades to the
 * RGBA preview atlas.
 */
export function loadFontColorLut(): Promise<TextureSource | undefined> {
  return loadTextureIfPresent(`/bobs/${FONT_COLOR_LUT_STEM}.png`);
}

/**
 * Load one font's layout metrics. `null` when the pipeline hasn't produced them, so a caller falls back
 * instead of crashing.
 */
export function loadFontMetrics(key: string): Promise<FontMetrics | null> {
  return fetchJsonOrNull<FontMetrics>(`${FONTS_ROOT}/${key}.metrics.json`);
}
