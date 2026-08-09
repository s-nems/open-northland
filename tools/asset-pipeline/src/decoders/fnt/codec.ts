/**
 * `.fnt` bitmap-font codec - CFont (storable id 0x3F5), a wrapper around the `.bmd` bob container.
 * Each glyph is one bob: character `c` (>= 0x20) draws bob `c - 0x20`. On disk:
 *
 *   [u32 id=0x3F5][u32 version]                  CFont storable header
 *   [u32 value08]                                font-level word, unknown
 *   [u32 value0C]                                font-level word, the observed nominal pixel size
 *   [u32 id=0x3F4][u32 version][ CBobManager … ] the nested bob container
 *
 * The wrapper is documented in `docs/formats/GRAPHICS.md`.
 */

import { type Bmd, decodeBmd, encodeBmd } from '../bmd/index.js';
import { viewOf } from '../byte-cursor.js';
import { StorableId } from '../storable.js';

const FONT_ID = StorableId.CFont; // 0x3F5
const BOB_MANAGER_ID = StorableId.CBobManager; // 0x3F4
/** Bytes of the CFont prefix before the nested CBobManager: id + version + value08 + value0C. */
const FONT_PREFIX_BYTES = 16;

/** Lowest character code represented by bob 0. */
export const FONT_FIRST_CHAR = 0x20;

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
  // Consumers address a glyph as bob `c - FONT_FIRST_CHAR`, so a non-zero origin would silently
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
