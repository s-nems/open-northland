/**
 * `.fnt` bitmap-font decoder — CFont (storable id 0x3F5), a thin wrapper around the `.bmd` bob container.
 *
 * A `.fnt` is one serialized `CStorable` whose body is two font-level words followed by a nested
 * `CBobManager` (id 0x3F4) — the same bob container the `.bmd` decoder already parses. Each glyph is one
 * bob; character `c` (>= 0x20) draws bob `c - 0x20`. On disk:
 *
 *   [u32 id=0x3F5][u32 version]                  CFont storable header
 *   [u32 value08]                                font-level word (unknown; carried verbatim)
 *   [u32 value0C]                                font-level word — empirically the nominal pixel size
 *                                                (8/10/12 for font08/10/12; 8 for fontdebug)
 *   [u32 id=0x3F4][u32 version][ CBobManager … ] the nested bob container ({@link decodeBmd} parses this)
 *
 * So a `.fnt` is exactly a 16-byte CFont prefix in front of a `.bmd`: we read the four words, then hand
 * the remainder straight to {@link decodeBmd}. The glyph atlas is then the ordinary bob atlas of that
 * inner container ({@link import('./atlas.js').packBobAtlas}); this module adds the font-specific layout
 * on top of it (per-glyph advance, line height, baseline).
 *
 * The wrapper and glyph metrics are documented in `docs/formats/GRAPHICS.md` and pinned by synthetic
 * round trips. Layout was established by inspecting owned font files and decoded glyph placement.
 *
 * Spacing is not stored in the file, so decoded advances default to zero extra spacing; callers may
 * provide one to {@link fontMetrics}.
 *
 * Pure functions only (no I/O): `(bytes) => decoded`. The CLI/stage wires file reads + atlas/PNG/JSON
 * writes around them. `encodeFnt` is the faithful inverse, used to round-trip test without committing
 * copyrighted fixtures (same rationale as the `.bmd`/`.pcx`/`.lib` encoder pairs).
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
 * The bob whose advance is used for spaces. Bob 0 is an empty slot, while bob 0x49 provides the
 * measured whitespace width. Rendering advances the pen without drawing that glyph.
 */
export const FONT_SPACE_BOB_ID = 0x49;

/** A decoded `.fnt` (CFont): the two font-level words plus the nested bob container. */
export interface Font {
  /** CFont storable version word (carried, not interpreted). */
  readonly version: number;
  /** CFont+0x08 — unknown font-level word, carried verbatim for a faithful round-trip. */
  readonly value08: number;
  /**
   * CFont+0x0C — carried verbatim. Empirically the font's nominal pixel size: 8/10/12 for font08/10/12
   * and 8 for fontdebug. Exposed as {@link FontMetrics.nominalSize}; not load-bearing (the real layout
   * comes from the per-glyph rects), so it is an observation, not a contract.
   */
  readonly value0C: number;
  /** The glyph bobs: bob `c - 0x20` is character `c`. Parsed by the shared `.bmd` container decoder. */
  readonly bmd: Bmd;
}

/**
 * Decodes a `.fnt` (CFont) into its font-level words + the nested bob container. Reads the 16-byte CFont
 * prefix, then hands the remainder to {@link decodeBmd} (the nested storable is a `.bmd` CBobManager).
 * Throws an `fnt:`-prefixed error on a too-short buffer, a wrong root id, or a font with no bob manager (a
 * null nested storable, which CFont writes as an id/version of 0) — a batch stage should wrap the call
 * per-file so one bad font can't abort the run.
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

  // The nested storable begins at offset 16. Peek its id for a clear font-level error before delegating;
  // a real font always carries a CBobManager, but CFont serializes a null one as id/version 0.
  const nestedId = view.getUint32(FONT_PREFIX_BYTES, true);
  if (nestedId !== BOB_MANAGER_ID) {
    throw new Error(
      `fnt: font has no CBobManager glyph container (nested storable id 0x${nestedId.toString(16)})`,
    );
  }
  const bmd = decodeBmd(bytes.subarray(FONT_PREFIX_BYTES));
  // A font's glyph container starts at bob 0, which is what makes char `FONT_FIRST_CHAR + i` addressable
  // as `glyphs[c - firstChar]` ({@link fontMetrics}). A non-zero origin would silently shift every glyph.
  if (bmd.firstBobId !== 0) {
    throw new Error(`fnt: glyph container must start at bob 0, got ${bmd.firstBobId}`);
  }

  return { version, value08, value0C, bmd };
}

/**
 * Inverse of {@link decodeFnt}: serializes the 16-byte prefix and nested bob container so a decode
 * can be round-tripped without committing copyrighted fixtures.
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

/** Reference characters (in priority order) whose baseline the font's baseline is derived from — see {@link deriveBaseline}. */
const BASELINE_REFERENCE_CHARS = ['H', 'E', 'A', 'T', 'I', 'X', '0'] as const;

/** The bob record for `bobId`, or `undefined` if the container has no such bob. */
function bobAt(bmd: Bmd, bobId: number): BobRecord | undefined {
  const index = bobId - bmd.firstBobId;
  if (index < 0 || index >= bmd.bobs.length) return undefined;
  return bmd.bobs[index];
}

/**
 * The pen advance for one bob: `spacing + area.x + area.width + 1`. Returns 0 for an absent or empty
 * bob; synthetic metrics tests pin both cases.
 */
export function bobAdvance(bmd: Bmd, bobId: number, spacing = 0): number {
  const bob = bobAt(bmd, bobId);
  if (bob === undefined || bob.type === BOB_TYPE_EMPTY) return 0;
  return spacing + bob.area.x + bob.area.width + 1;
}

/**
 * The line height: the maximum `area.height + area.y + 1` over non-empty bobs. Empty slots are skipped
 * so stale rectangle values cannot inflate the result.
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
 * A derived baseline (advisory, not stored in the format): the bottom edge `area.y + area.height` of the first
 * available reference capital ({@link BASELINE_REFERENCE_CHARS}), since capitals sit on the baseline.
 * The original has no baseline concept — it lays glyphs out top-anchored, blitting each at `pen + (x, y)`
 * and advancing by {@link bobAdvance}. A convenience for a renderer aligning mixed content; falls back to
 * the line height when no reference glyph has pixels (e.g. a partial debug font). Heuristic, source basis.
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

/** One glyph's layout metrics, keyed by character code. JSON-serializable (plain numbers/booleans only). */
export interface GlyphMetric {
  /** The character code this glyph renders (`FONT_FIRST_CHAR + bobId`). */
  readonly char: number;
  /** The bob (atlas frame) id to draw for this char: `char - FONT_FIRST_CHAR`. Space's is an empty bob. */
  readonly bobId: number;
  /** Pen advance after this glyph (`spacing + x + w + 1`; 0 for an empty slot); space borrows bob 0x49's advance. */
  readonly advance: number;
  /** Draw offset X from the pen origin (bob `area.x`). */
  readonly offsetX: number;
  /** Draw offset Y from the line top (bob `area.y`). */
  readonly offsetY: number;
  /** Glyph width in px (bob `area.width`). 0 for an empty glyph (space, or an undefined slot). */
  readonly width: number;
  /** Glyph height in px (bob `area.height`). 0 for an empty glyph. */
  readonly height: number;
  /** True when the glyph draws no pixels (an empty bob / zero size), e.g. space and undefined chars. */
  readonly empty: boolean;
}

/** A font's full layout table: font-wide metrics + one {@link GlyphMetric} per character, in char order. */
export interface FontMetrics {
  /** First character code (`FONT_FIRST_CHAR`); glyph for char `c` is `glyphs[c - firstChar]`. */
  readonly firstChar: number;
  /** Number of glyphs (= the container's bob count); characters are `firstChar .. firstChar + charCount - 1`. */
  readonly charCount: number;
  /** The bob a space/tab is measured through ({@link FONT_SPACE_BOB_ID}); recorded for the consumer. */
  readonly spaceBobId: number;
  /** Line height (max glyph extent) — see {@link deriveLineHeight}. */
  readonly lineHeight: number;
  /** Derived baseline (advisory) — see {@link deriveBaseline}. */
  readonly baseline: number;
  /** The font's nominal pixel size ({@link Font.value0C}); an observation, not load-bearing. */
  readonly nominalSize: number;
  /** Per-character metrics in char order (`glyphs[i]` is char `firstChar + i`). */
  readonly glyphs: readonly GlyphMetric[];
}

/**
 * Builds a font's full layout table from a decoded {@link Font}: one {@link GlyphMetric} per bob (char
 * `FONT_FIRST_CHAR + bobId`), plus the font-wide line height, baseline, and nominal size. Space (char
 * 0x20) borrows bob {@link FONT_SPACE_BOB_ID}'s advance while drawing nothing. Pure; deterministic
 * character-order output.
 *
 * `spacing` is added to every advance. The file carries none, so it defaults to zero.
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
    // Space uses bob 0x49's width; every other character uses its own bob's advance.
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
