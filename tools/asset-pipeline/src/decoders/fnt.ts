/**
 * `.fnt` bitmap-font decoder - CFont (storable id 0x3F5), a wrapper around the `.bmd` bob container.
 * Each glyph is one bob: character `c` (>= 0x20) draws bob `c - 0x20`. On disk:
 *
 *   [u32 id=0x3F5][u32 version]                  CFont storable header
 *   [u32 value08]                                font-level word, unknown
 *   [u32 value0C]                                font-level word, the observed nominal pixel size
 *   [u32 id=0x3F4][u32 version][ CBobManager … ] the nested bob container
 *
 * Glyph layout is an observation from decoded glyph placement in owned font files; the wrapper is
 * documented in `docs/formats/GRAPHICS.md`.
 */

import { type Bmd, BOB_TYPE_EMPTY, type BobRecord, decodeBmd, encodeBmd } from './bmd/index.js';
import { viewOf } from './byte-cursor.js';
import { StorableId } from './storable.js';

const FONT_ID = StorableId.CFont; // 0x3F5
const BOB_MANAGER_ID = StorableId.CBobManager; // 0x3F4
/** Bytes of the CFont prefix before the nested CBobManager: id + version + value08 + value0C. */
const FONT_PREFIX_BYTES = 16;

/** Lowest character code represented by bob 0. */
export const FONT_FIRST_CHAR = 0x20;
/**
 * The bob whose advance measures a space. The space's own bob 0 is an empty slot, so rendering
 * advances the pen without drawing a glyph.
 */
export const FONT_SPACE_BOB_ID = 0x49;

/** A decoded `.fnt` (CFont): the two font-level words plus the nested bob container. */
export interface Font {
  /** CFont storable version word (carried, not interpreted). */
  readonly version: number;
  /** CFont+0x08 - unknown font-level word, carried verbatim for a faithful round-trip. */
  readonly value08: number;
  /**
   * CFont+0x0C - carried verbatim. Observed as the font's nominal pixel size: 8/10/12 for
   * font08/10/12 and 8 for fontdebug. Not load-bearing; layout comes from the per-glyph rects.
   */
  readonly value0C: number;
  /** The glyph bobs: bob `c - 0x20` is character `c`. */
  readonly bmd: Bmd;
}

/**
 * Decodes a `.fnt` (CFont) into its font-level words plus the nested bob container. Throws an
 * `fnt:`-prefixed error on a malformed envelope or a font with no bob manager.
 */
export function decodeFnt(bytes: Uint8Array): Font {
  if (bytes.length < FONT_PREFIX_BYTES + 4) {
    throw new Error(`fnt: buffer of ${bytes.length} bytes is too short for a CFont header`);
  }
  const view = viewOf(bytes);

  const id = view.getUint32(0, true);
  if (id !== FONT_ID) {
    throw new Error(`fnt: root is not a CFont (0x3F5); got 0x${id.toString(16)}`);
  }
  const version = view.getUint32(4, true);
  const value08 = view.getUint32(8, true);
  const value0C = view.getUint32(12, true);

  // CFont serializes a null bob manager as id/version 0, so peek the nested id before delegating.
  const nestedId = view.getUint32(FONT_PREFIX_BYTES, true);
  if (nestedId !== BOB_MANAGER_ID) {
    throw new Error(
      `fnt: font has no CBobManager glyph container (nested storable id 0x${nestedId.toString(16)})`,
    );
  }
  const bmd = decodeBmd(bytes.subarray(FONT_PREFIX_BYTES));
  // `fontMetrics` addresses glyphs as `glyphs[c - firstChar]`, so a non-zero origin would silently
  // shift every glyph rather than fail.
  if (bmd.firstBobId !== 0) {
    throw new Error(`fnt: glyph container must start at bob 0, got ${bmd.firstBobId}`);
  }

  return { version, value08, value0C, bmd };
}

/**
 * Inverse of `decodeFnt`, so a decode can be round-tripped without committing copyrighted fixtures.
 */
export function encodeFnt(font: Font): Uint8Array {
  const bmdBytes = encodeBmd(font.bmd);
  const out = new Uint8Array(FONT_PREFIX_BYTES + bmdBytes.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, FONT_ID, true);
  dv.setUint32(4, font.version >>> 0, true);
  dv.setUint32(8, font.value08 >>> 0, true);
  dv.setUint32(12, font.value0C >>> 0, true);
  out.set(bmdBytes, FONT_PREFIX_BYTES);
  return out;
}

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
