/**
 * `.bmd` bob RLE frame codec: decodes a container's packed-line stream into indexed pixels plus an
 * opacity mask. No palette is applied here; a bob's palette lives outside the `.bmd`.
 *
 * The packed-line layout was established through owned-file inspection and is pinned by synthetic
 * run, skip, mask, clipping, and round-trip tests.
 */

import {
  type Bmd,
  BOB_ALPHA_OPAQUE,
  BOB_MASK_INDEX,
  BOB_TYPE_1BIT,
  BOB_TYPE_DOUBLE8BIT,
  BOB_TYPE_EMPTY,
  BOB_TYPE_TIMEMASK,
  type BobRecord,
  PACKED_OFFSET_MASK,
  PACKED_X_SHIFT,
} from './container.js';

/** Sentinel line-control word meaning "this scanline is fully transparent". */
const LINE_CONTROL_EMPTY = 0xffffffff;

/**
 * One decoded bob frame: indexed pixels plus a parallel opacity mask. Index 0 is a real palette colour
 * here, transparency being per-pixel via the codec's skip runs, so only {@link mask} says which pixels
 * were written; an unwritten pixel keeps `index 0`, `mask 0`.
 */
export interface BobFrame {
  /** Frame width in pixels (the bob's `area.width`). */
  readonly width: number;
  /** Frame height in pixels (the bob's `area.height`). */
  readonly height: number;
  /** Row-major (top→bottom) palette indices, length `width * height`. Unwritten pixels are 0. */
  readonly pixels: Uint8Array;
  /**
   * Row-major opacity, 0-255: 0 where the codec skipped, {@link BOB_ALPHA_OPAQUE} for a written pixel of
   * a single-byte type, and the pixel's own alpha byte for a {@link BOB_TYPE_DOUBLE8BIT} decoded as
   * `'alpha'`. A `'time'`-decoded pixel is opaque here; its threshold lives in {@link time}.
   */
  readonly mask: Uint8Array;
  /**
   * Row-major 0-255 build-progress thresholds: a pixel first appears when construction progress reaches
   * its value. Present only for a {@link BOB_TYPE_TIMEMASK} bob or a {@link BOB_TYPE_DOUBLE8BIT} decoded
   * with `secondByte: 'time'`, and meaningful only where `mask` is nonzero.
   */
  readonly time?: Uint8Array;
}

/**
 * How {@link decodeBobFrame} reads a {@link BOB_TYPE_DOUBLE8BIT} pair's second byte: per-pixel `'alpha'`
 * or `'time'`. The meaning is a property of the consumer, not the file; a TimeMask bob is always time.
 */
export type SecondByteMode = 'alpha' | 'time';

/**
 * Decodes one bob's packed-line RLE into an indexed-pixel frame + opacity mask.
 *
 * Format: the bob's `area` gives the frame size and its scanlines are `lineControl[bob.misc + line]`.
 * Each of the `height` words is either {@link LINE_CONTROL_EMPTY} (fully transparent row) or
 * `[xMin (10b)][offset (22b)]`. From `packedLineData[offset]` control bytes run until a `0` terminator:
 * high bit clear is a raw run of `count = b & 0x7F` pixels whose data follows inline, high bit set is a
 * transparent skip run of `count`. Either way the cursor advances `count` columns, in the bob's local
 * frame space starting at `xMin`; `area.x` is the draw offset and is not applied here.
 *
 * Per-type pixel width within a raw run: 8-bit stores one index byte each; TimeMask and Double8Bit store
 * two bytes each (`[value, timeByte]` / `[index, alpha-or-time]`); 1-bit masks store no pixel bytes, the
 * run itself being the coverage (`count` set pixels, drawn as {@link BOB_MASK_INDEX}). An empty bob
 * (`type 0`) or non-positive size yields an all-transparent frame sized to the clamped area.
 *
 * Throws a `bmd:`-prefixed error on an out-of-range `bobIndex`. A structurally corrupt packed-line
 * stream is tolerated instead: the walker stops at the buffer end and at any column outside the frame,
 * like the original's clipped `Draw_SetPixel`.
 */
export function decodeBobFrame(bmd: Bmd, bobIndex: number, secondByte: SecondByteMode = 'alpha'): BobFrame {
  if (bobIndex < 0 || bobIndex >= bmd.bobs.length) {
    throw new Error(`bmd: bob index ${bobIndex} out of range (have ${bmd.bobs.length} bobs)`);
  }
  const bob = bmd.bobs[bobIndex] as BobRecord;
  const width = Math.max(0, bob.area.width);
  const height = Math.max(0, bob.area.height);
  const pixels = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);

  if (bob.type === BOB_TYPE_EMPTY || width === 0 || height === 0) {
    return { width, height, pixels, mask };
  }

  const isMask = bob.type === BOB_TYPE_1BIT;
  const isPair = bob.type === BOB_TYPE_DOUBLE8BIT || bob.type === BOB_TYPE_TIMEMASK;
  const isAlpha = bob.type === BOB_TYPE_DOUBLE8BIT && secondByte === 'alpha';
  const bytesPerPixel = isPair ? 2 : 1;
  const time = isPair && !isAlpha ? new Uint8Array(width * height) : undefined;
  const packed = bmd.packedLineData;
  const frame = (): BobFrame =>
    time === undefined ? { width, height, pixels, mask } : { width, height, pixels, mask, time };

  for (let line = 0; line < height; line++) {
    const ctrlIndex = bob.misc + line;
    if (ctrlIndex < 0 || ctrlIndex >= bmd.lineControl.length) continue;
    const ctrl = bmd.lineControl[ctrlIndex] as number;
    if (ctrl === LINE_CONTROL_EMPTY) continue;

    const xMin = ctrl >>> PACKED_X_SHIFT;
    let pos = ctrl & PACKED_OFFSET_MASK;
    if (pos >= packed.length) continue;

    // Column cursor in the bob's local frame space; `xMin` is the row's first written column.
    let absX = xMin;
    const rowBase = line * width;

    let b = packed[pos] as number;
    while (b !== 0) {
      pos++;
      const count = b & 0x7f;
      const isRaw = (b & 0x80) === 0;

      if (isRaw && isMask) {
        // Pinned by decoding real shadow `.bmd`s: this byte-less reading yields coherent solid
        // silhouettes on every shadow lib, while a byte-per-pixel reading desyncs the stream into noise.
        for (let i = 0; i < count; i++) {
          const col = absX + i;
          if (col >= 0 && col < width) {
            pixels[rowBase + col] = BOB_MASK_INDEX;
            mask[rowBase + col] = BOB_ALPHA_OPAQUE;
          }
        }
      } else if (isRaw) {
        for (let i = 0; i < count; i++) {
          if (pos + bytesPerPixel > packed.length) {
            return frame(); // truncated stream: stop, like the clipped original
          }
          const value = packed[pos] as number;
          const second = isPair ? (packed[pos + 1] as number) : BOB_ALPHA_OPAQUE;
          pos += bytesPerPixel;
          const col = absX + i;
          // An alpha pair's 0 skips the write, leaving the pixel unwritten (`index 0, mask 0`). A time
          // pair's 0 is a real pixel, visible from the start of construction.
          if (col >= 0 && col < width && !(isAlpha && second === 0)) {
            pixels[rowBase + col] = value;
            mask[rowBase + col] = isAlpha ? second : BOB_ALPHA_OPAQUE;
            if (time !== undefined) time[rowBase + col] = second;
          }
        }
      }
      // A skip run needs no write: mask stays 0, which is already transparent.

      absX += count;
      if (pos >= packed.length) break;
      b = packed[pos] as number;
    }
  }

  return frame();
}
