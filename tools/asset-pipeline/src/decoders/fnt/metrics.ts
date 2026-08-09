/**
 * Font layout metrics derived from a decoded `.fnt`. Glyph layout is an observation from decoded
 * glyph placement in owned font files, not a field the format stores.
 */

import { type Bmd, BOB_TYPE_EMPTY, type BobRecord } from '../bmd/index.js';
import { FONT_FIRST_CHAR, type Font } from './codec.js';

/**
 * The bob whose advance measures a space. The space's own bob 0 is an empty slot, so rendering
 * advances the pen without drawing a glyph.
 */
export const FONT_SPACE_BOB_ID = 0x49;

/** Characters, in priority order, whose bottom edge the font baseline is derived from. */
const BASELINE_REFERENCE_CHARS = ['H', 'E', 'A', 'T', 'I', 'X', '0'] as const;

function bobAt(bmd: Bmd, bobId: number): BobRecord | undefined {
  const index = bobId - bmd.firstBobId;
  if (index < 0 || index >= bmd.bobs.length) return undefined;
  return bmd.bobs[index];
}

/** The pen advance for one bob: `spacing + area.x + area.width + 1`. */
export function bobAdvance(bmd: Bmd, bobId: number, spacing = 0): number {
  const bob = bobAt(bmd, bobId);
  if (bob === undefined || bob.type === BOB_TYPE_EMPTY) return 0;
  return spacing + bob.area.x + bob.area.width + 1;
}

/**
 * The line height: the maximum `area.height + area.y + 1` over non-empty bobs. Empty slots can carry
 * stale rectangle values, so they are skipped.
 */
export function deriveLineHeight(bmd: Bmd): number {
  let max = 0;
  for (const bob of bmd.bobs) {
    if (bob.type === BOB_TYPE_EMPTY) continue;
    const extent = bob.area.height + bob.area.y + 1;
    if (extent > max) max = extent;
  }
  return max;
}

/**
 * A baseline approximation: the bottom edge `area.y + area.height` of the first available reference
 * capital, falling back to the line height. The format stores no baseline and the original lays glyphs
 * out top-anchored, so this exists only for a renderer aligning mixed content.
 */
export function deriveBaseline(bmd: Bmd): number {
  for (const ch of BASELINE_REFERENCE_CHARS) {
    const bob = bobAt(bmd, ch.charCodeAt(0) - FONT_FIRST_CHAR);
    if (bob !== undefined && bob.type !== BOB_TYPE_EMPTY && bob.area.height > 0) {
      return bob.area.y + bob.area.height;
    }
  }
  return deriveLineHeight(bmd);
}

/** One glyph's layout metrics; written to JSON, so plain numbers and booleans only. */
export interface GlyphMetric {
  /** The character code this glyph renders (`FONT_FIRST_CHAR + bobId`). */
  readonly char: number;
  /** The bob (atlas frame) id to draw for this char: `char - FONT_FIRST_CHAR`. */
  readonly bobId: number;
  /** Pen advance after this glyph; space borrows bob 0x49's advance. */
  readonly advance: number;
  /** Draw offset X from the pen origin (bob `area.x`). */
  readonly offsetX: number;
  /** Draw offset Y from the line top (bob `area.y`). */
  readonly offsetY: number;
  /** Glyph width in px (bob `area.width`). */
  readonly width: number;
  /** Glyph height in px (bob `area.height`). */
  readonly height: number;
  /** True when the glyph draws no pixels: an empty bob or a zero-sized rectangle. */
  readonly empty: boolean;
}

/** A font's full layout table: font-wide metrics plus one entry per character, in char order. */
export interface FontMetrics {
  /** First character code (`FONT_FIRST_CHAR`); glyph for char `c` is `glyphs[c - firstChar]`. */
  readonly firstChar: number;
  /** Number of glyphs, which is the container's bob count. */
  readonly charCount: number;
  /** The bob a space is measured through, recorded for the consumer. */
  readonly spaceBobId: number;
  /** Line height: the maximum glyph extent. */
  readonly lineHeight: number;
  /** The derived baseline approximation. */
  readonly baseline: number;
  /** The font's observed nominal pixel size (CFont+0x0C); not load-bearing. */
  readonly nominalSize: number;
  /** Per-character metrics in char order (`glyphs[i]` is char `firstChar + i`). */
  readonly glyphs: readonly GlyphMetric[];
}

/**
 * Builds a font's layout table from a decoded font: one entry per bob, in character order. `spacing`
 * is added to every advance; the file carries none, so it defaults to zero.
 */
export function fontMetrics(font: Font, spacing = 0): FontMetrics {
  const { bmd } = font;
  const spaceAdvance = bobAdvance(bmd, FONT_SPACE_BOB_ID, spacing);

  const glyphs: GlyphMetric[] = [];
  for (let i = 0; i < bmd.bobs.length; i++) {
    const bob = bmd.bobs[i] as BobRecord;
    const bobId = bmd.firstBobId + i;
    const char = FONT_FIRST_CHAR + bobId;
    const empty = bob.type === BOB_TYPE_EMPTY || bob.area.width <= 0 || bob.area.height <= 0;
    const advance = char === FONT_FIRST_CHAR ? spaceAdvance : bobAdvance(bmd, bobId, spacing);
    glyphs.push({
      char,
      bobId,
      advance,
      offsetX: bob.area.x,
      offsetY: bob.area.y,
      width: Math.max(0, bob.area.width),
      height: Math.max(0, bob.area.height),
      empty,
    });
  }

  return {
    firstChar: FONT_FIRST_CHAR,
    charCount: bmd.bobs.length,
    spaceBobId: FONT_SPACE_BOB_ID,
    lineHeight: deriveLineHeight(bmd),
    baseline: deriveBaseline(bmd),
    nominalSize: font.value0C,
    glyphs,
  };
}
