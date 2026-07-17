/**
 * `.bmd` bob RLE frame codec — turns a decoded {@link Bmd} container's packed-line stream into frame
 * pixels: indexed pixels + an opacity mask, with palette/atlas concerns left out (the bob's palette lives
 * outside the `.bmd`), the way `.pcx` keeps `expandToRgba` separate from `decodePcx`.
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
 * here (transparency is per-pixel via the codec's skip runs, not a reserved index), so a renderer needs
 * {@link mask} to know which pixels were actually written; unwritten pixels keep `index 0`, `mask 0`.
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
   * type is {@link BOB_ALPHA_OPAQUE}; a {@link BOB_TYPE_DOUBLE8BIT} pixel decoded as `'alpha'` carries
   * its per-pixel alpha byte (the soft decals — ferns, smoke, wave foam — encode their feathered
   * translucency there). A `'time'`-decoded pixel is fully opaque here; its threshold lives in {@link time}.
   */
  readonly mask: Uint8Array;
  /**
   * Row-major 0–255 build-progress thresholds — the pair's second byte read as the engine's TimeMask
   * `timeByte` (a pixel first appears when construction progress reaches it; see {@link BOB_TYPE_TIMEMASK}).
   * Present only for a {@link BOB_TYPE_TIMEMASK} bob or a {@link BOB_TYPE_DOUBLE8BIT} decoded with
   * `secondByte: 'time'`; meaningful only where `mask ≠ 0`.
   */
  readonly time?: Uint8Array;
}

/**
 * How {@link decodeBobFrame} reads a {@link BOB_TYPE_DOUBLE8BIT} pair's second byte — per-pixel `'alpha'`
 * (the soft decals) or `'time'` (a `[GfxHouse]` bob's construction-progress threshold). The meaning is a
 * property of the consumer, not the file (see {@link BOB_TYPE_DOUBLE8BIT}); a TimeMask bob is always time.
 */
export type SecondByteMode = 'alpha' | 'time';

/**
 * Decodes one bob's packed-line RLE into an indexed-pixel frame + opacity mask.
 *
 * Format: the bob's `area` gives the frame size; its scanlines are
 * `lineControl[bob.misc + line]` (`misc` is the bob's first-line
 * index into the contiguously-stacked line-control array — not `area.y`, which is the draw offset). For
 * each of `height` scanlines that word is either {@link LINE_CONTROL_EMPTY} (fully transparent row) or
 * `[xMin (10b)][offset (22b)]`. From `packedLineData[offset]` we walk control bytes until a `0`
 * terminator: a byte with the high bit clear is a raw run of `count = b & 0x7F` pixels whose data
 * follows inline; high bit set is a skip run (transparent) of `count` pixels. Either way the cursor
 * advances `count` columns. Columns are in the bob's local frame space (starting at `xMin`); `area.x` is
 * the draw offset and is not applied here.
 *
 * Per-type pixel width within a raw run: 8-bit stores one index byte each; TimeMask and Double8Bit store
 * two bytes each (`[value, timeByte]` / `[index, alpha-or-time]` — see {@link BOB_TYPE_TIMEMASK} /
 * {@link BOB_TYPE_DOUBLE8BIT} and `secondByte`); 1-bit masks store no pixel bytes — a raw run is itself
 * the coverage (`count` set pixels, drawn as {@link BOB_MASK_INDEX}; pinned on the real shadow `.bmd`s,
 * whose silhouettes only decode coherently this way).
 * An empty bob (`type 0`) or non-positive size yields a frame sized to the (clamped) area with an all-transparent mask.
 *
 * Throws a `bmd:`-prefixed error on an out-of-range `bobIndex` (a programmer error). A structurally
 * corrupt packed-line stream is tolerated, not thrown: the walker stops at the buffer end and at any
 * column outside the frame, exactly like the original's clipped `Draw_SetPixel` (a recoverable boundary).
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

  // Empty slot / degenerate size: an all-transparent frame, sized to the area.
  if (bob.type === BOB_TYPE_EMPTY || width === 0 || height === 0) {
    return { width, height, pixels, mask };
  }

  // Per raw-run pixel: how many packed bytes it consumes and what the pair's second byte means.
  const isMask = bob.type === BOB_TYPE_1BIT;
  const isPair = bob.type === BOB_TYPE_DOUBLE8BIT || bob.type === BOB_TYPE_TIMEMASK;
  const isAlpha = bob.type === BOB_TYPE_DOUBLE8BIT && secondByte === 'alpha';
  const bytesPerPixel = isPair ? 2 : 1;
  const time = isPair && !isAlpha ? new Uint8Array(width * height) : undefined;
  const packed = bmd.packedLineData;
  const frame = (): BobFrame =>
    time === undefined ? { width, height, pixels, mask } : { width, height, pixels, mask, time };

  for (let line = 0; line < height; line++) {
    // `area.x`/`area.y` are the draw offset (often negative), applied only when blitting.
    const ctrlIndex = bob.misc + line;
    if (ctrlIndex < 0 || ctrlIndex >= bmd.lineControl.length) continue;
    const ctrl = bmd.lineControl[ctrlIndex] as number;
    if (ctrl === LINE_CONTROL_EMPTY) continue;

    const xMin = ctrl >>> PACKED_X_SHIFT;
    let pos = ctrl & PACKED_OFFSET_MASK;
    if (pos >= packed.length) continue;

    // Column cursor in the bob's local frame space (0..width); `xMin` is the row's first written column.
    let absX = xMin;
    const rowBase = line * width;

    let b = packed[pos] as number;
    while (b !== 0) {
      pos++;
      const count = b & 0x7f;
      const isRaw = (b & 0x80) === 0;

      if (isRaw && isMask) {
        // Pinned by decoding real shadow `.bmd`s: this byte-less reading yields coherent solid
        // silhouettes on every shadow lib, while a byte-per-pixel reading desyncs the stream into
        // noise. Matches cultures2-wasm's `read_bmd` shadow-frame path.
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
          // An alpha pair's 0 skips the write entirely — the engine's `a <= 0 → continue` — so the
          // pixel stays genuinely unwritten (`index 0, mask 0`). A time pair's 0 is a real pixel
          // (visible from the very start of construction), written opaque with its threshold in `time`.
          if (col >= 0 && col < width && !(isAlpha && second === 0)) {
            pixels[rowBase + col] = value;
            mask[rowBase + col] = isAlpha ? second : BOB_ALPHA_OPAQUE;
            if (time !== undefined) time[rowBase + col] = second;
          }
        }
      }
      // Skip runs leave mask=0 — already transparent.

      absX += count;
      if (pos >= packed.length) break;
      b = packed[pos] as number;
    }
  }

  return frame();
}
