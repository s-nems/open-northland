/**
 * `.bmd` bob RLE frame codec — turns a decoded {@link Bmd} container's packed-line stream into actual
 * frame pixels. Kept beside the container parse ({@link ./container}) the way `.pcx` keeps `expandToRgba`
 * separate from `decodePcx`: the container yields indexed pixels + an opacity mask; palette/atlas
 * concerns stay out (the bob's palette lives outside the `.bmd`).
 *
 * Ported FORMAT from CBobManager `PrintBob_*Core` + the `PrintPackedLine_*` walkers.
 */

import {
  type Bmd,
  BOB_ALPHA_OPAQUE,
  BOB_MASK_INDEX,
  BOB_TYPE_1BIT,
  BOB_TYPE_DOUBLE8BIT,
  BOB_TYPE_EMPTY,
  type BobRecord,
  PACKED_OFFSET_MASK,
  PACKED_X_SHIFT,
} from './container.js';

/** Sentinel line-control word meaning "this scanline is fully transparent" (CBobManager `0xFFFFFFFF`). */
const LINE_CONTROL_EMPTY = 0xffffffff;

/**
 * One decoded bob frame: indexed pixels plus a parallel opacity mask. Index 0 is a real palette colour
 * here (transparency is per-pixel via the codec's skip runs, not a reserved index), so a renderer needs
 * {@link mask} to know which pixels were actually written; unwritten pixels keep `index 0`, `mask 0`.
 * Convert to RGBA by sampling a palette at each `mask≠0` pixel (the bob's palette lives outside the `.bmd`),
 * carrying the mask value as the pixel's alpha.
 */
export interface BobFrame {
  /** Frame width in pixels (the bob's `area.width`). */
  readonly width: number;
  /** Frame height in pixels (the bob's `area.height`). */
  readonly height: number;
  /** Row-major (top→bottom) palette indices, length `width * height`. Unwritten pixels are 0. */
  readonly pixels: Uint8Array;
  /**
   * Row-major opacity, 0–255: 0 where the codec skipped (transparent); a written pixel of a single-byte
   * type is {@link BOB_ALPHA_OPAQUE}; a {@link BOB_TYPE_DOUBLE8BIT} pixel carries its per-pixel alpha
   * byte (the soft decals — ferns, smoke, wave foam — encode their feathered translucency there).
   */
  readonly mask: Uint8Array;
}

/**
 * Decodes one bob's packed-line RLE into an indexed-pixel frame + opacity mask. Pure: it reads only the
 * already-parsed {@link Bmd} blocks, so palette/atlas concerns stay out of the codec (mirrors how `.pcx`
 * yields indexed pixels and `expandToRgba` is a separate step).
 *
 * Format (ported from CBobManager `PrintBob_*Core` + the `PrintPackedLine_*` walkers): the bob's `area`
 * gives the frame size; its scanlines are `lineControl[bob.misc + line]` (`misc` is the bob's first-line
 * index into the contiguously-stacked line-control array — NOT `area.y`, which is the draw offset). For
 * each of `height` scanlines that word is either {@link LINE_CONTROL_EMPTY} (fully transparent row) or
 * `[xMin (10b)][offset (22b)]`. From `packedLineData[offset]` we walk control bytes until a `0`
 * terminator: a byte with the high bit clear is a **raw run** of `count = b & 0x7F` pixels whose data
 * follows inline; high bit set is a **skip run** (transparent) of `count` pixels. Either way the cursor
 * advances `count` columns. Columns are in the bob's LOCAL frame space (starting at `xMin`); `area.x` is
 * the draw offset and is NOT applied here.
 *
 * Per-type pixel width within a raw run: 8-bit/TimeMask store one index byte each; Double8Bit stores two
 * bytes each (index, then the pixel's alpha byte — see {@link BOB_TYPE_DOUBLE8BIT}); 1-bit masks store one
 * 0/1 byte each, drawn as {@link BOB_MASK_INDEX}.
 * An empty bob (`type 0`) or non-positive size yields a frame sized to the (clamped) area with an all-transparent mask.
 *
 * Throws a `bmd:`-prefixed error on an out-of-range `bobIndex` (a programmer error). A structurally
 * corrupt packed-line stream is tolerated, not thrown: the walker stops at the buffer end and at any
 * column outside the frame, exactly like the original's clipped `Draw_SetPixel` (a recoverable boundary).
 */
export function decodeBobFrame(bmd: Bmd, bobIndex: number): BobFrame {
  if (bobIndex < 0 || bobIndex >= bmd.bobs.length) {
    throw new Error(`bmd: bob index ${bobIndex} out of range (have ${bmd.bobs.length} bobs)`);
  }
  const bob = bmd.bobs[bobIndex] as BobRecord;
  const width = Math.max(0, bob.area.width);
  const height = Math.max(0, bob.area.height);
  const pixels = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);

  // Empty slot / degenerate size: an all-transparent frame, sized to the area.
  if (bob.type === BOB_TYPE_EMPTY || width === 0 || height === 0) {
    return { width, height, pixels, mask };
  }

  // Per raw-run pixel: how many packed bytes it consumes, and the index it yields from those bytes.
  const isDouble = bob.type === BOB_TYPE_DOUBLE8BIT;
  const isMask = bob.type === BOB_TYPE_1BIT;
  const bytesPerPixel = isDouble ? 2 : 1;
  const packed = bmd.packedLineData;

  for (let line = 0; line < height; line++) {
    // The bob's scanlines occupy a CONTIGUOUS block of the global line-control array starting at
    // `bob.misc` — its first-line index, NOT `area.y` (area.x/area.y are the DRAW offset, often
    // negative, applied only when blitting; see the `misc`/`area` field docs). Using `area.y` here was
    // the bug that decoded only the bottom few rows of each bob (a tiny fragment).
    const ctrlIndex = bob.misc + line;
    if (ctrlIndex < 0 || ctrlIndex >= bmd.lineControl.length) continue;
    const ctrl = bmd.lineControl[ctrlIndex] as number;
    if (ctrl === LINE_CONTROL_EMPTY) continue;

    const xMin = ctrl >>> PACKED_X_SHIFT;
    let pos = ctrl & PACKED_OFFSET_MASK;
    if (pos >= packed.length) continue;

    // Column cursor in the bob's LOCAL frame space (0..width). `xMin` is the first non-transparent
    // local column; runs advance from there. area.x is the draw offset, NOT subtracted here (doing so
    // shifted content right and clipped hundreds of pixels off the right edge).
    let absX = xMin;
    const rowBase = line * width;

    let b = packed[pos] as number;
    while (b !== 0) {
      pos++;
      const count = b & 0x7f;
      const isRaw = (b & 0x80) === 0;

      if (isRaw) {
        for (let i = 0; i < count; i++) {
          if (pos + bytesPerPixel > packed.length) {
            return { width, height, pixels, mask }; // truncated stream: stop, like the clipped original
          }
          const value = packed[pos] as number;
          // Double8Bit: the pair's second byte is the pixel's alpha (see BOB_TYPE_DOUBLE8BIT). An
          // alpha of 0 skips the write entirely — the engine's `a <= 0 → continue` — so the pixel
          // stays genuinely unwritten (`index 0, mask 0`), keeping the frame invariant.
          const coverage = isDouble ? (packed[pos + 1] as number) : BOB_ALPHA_OPAQUE;
          pos += bytesPerPixel;
          const col = absX + i;
          if (col >= 0 && col < width && coverage !== 0) {
            if (isMask) {
              if (value !== 0) {
                pixels[rowBase + col] = BOB_MASK_INDEX;
                mask[rowBase + col] = BOB_ALPHA_OPAQUE;
              }
            } else {
              pixels[rowBase + col] = value;
              mask[rowBase + col] = coverage;
            }
          }
        }
      }
      // Skip runs (and the not-drawn pixels of a mask raw run) leave mask=0 — already transparent.

      absX += count;
      if (pos >= packed.length) break;
      b = packed[pos] as number;
    }
  }

  return { width, height, pixels, mask };
}
