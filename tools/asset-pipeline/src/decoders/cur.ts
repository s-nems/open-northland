/**
 * Windows cursor (`.cur`) decoder — the ICO/CUR container: a directory of DIB (BMP) images plus a
 * per-image hotspot. A `.cur` is byte-identical to a `.ico` except the two `ICONDIRENTRY` fields that
 * an icon uses for colour-planes / bit-count instead carry the cursor hotspot (X, Y).
 *
 * This ports the format of a standard Microsoft resource, not any OpenVikings code: the original engine
 * loads cursors through Win32 `LoadCursorFromFileW` (see `Source/SystemHandles/InitGameHandler.cs`), so
 * there is no decoder to mirror — the OS reads the same header this does. Layout (all multi-byte fields
 * little-endian):
 *
 *   ICONDIR    : u16 reserved(0), u16 type(2 = cursor / 1 = icon), u16 count
 *   ICONDIRENTRY[count], 16 bytes each:
 *     u8 width(0 = 256), u8 height, u8 colorCount, u8 reserved,
 *     u16 hotspotX, u16 hotspotY,          (planes / bitCount in a .ico)
 *     u32 bytesInRes, u32 imageOffset
 *   image = a bottom-up `BITMAPINFOHEADER` DIB whose `biHeight` is doubled (the XOR colour bitmap
 *     stacked over a 1-bpp AND transparency mask). Real height = biHeight / 2.
 *
 * The game's three cursors each pack 1/4/8-bpp variants of one 32×32 image; we decode the highest
 * colour depth available (only 8/24/32-bpp are implemented — the shipped cursors always carry an 8-bpp
 * entry, which is the one selected, so a ≤4-bpp-only cursor is not a real case) and take transparency
 * from the AND mask (a set AND bit = transparent). The hotspot is read from that same selected entry, so
 * image + hotspot stay self-consistent — matching what the original's Win32 `LoadCursorFromFileW`
 * best-fits on the game's 32-bpp display (it picks the 8-bpp image and uses its hotspot, not a
 * lower-depth entry's; e.g. `MouseRight`'s 8-bpp hotspot is (1,1), while its 1-bpp fallback carries (10,10)).
 *
 * Pure functions only (no I/O): `(bytes) => decoded`. `encodeCursor` is a faithful (8-bpp) inverse used
 * to round-trip test without committing copyrighted fixtures — same rationale as the other encoder pairs.
 */

import { viewOf } from './byte-cursor.js';
import { assertPaletteBytes, type RgbaImage } from './image.js';

/** ICONDIR / ICONDIRENTRY sizes and the cursor resource type. */
const ICONDIR_BYTES = 6;
const ICONDIRENTRY_BYTES = 16;
const RES_TYPE_CURSOR = 2;
const RES_TYPE_ICON = 1;
/** A `BITMAPINFOHEADER` is 40 bytes. */
const DIB_HEADER_BYTES = 40;
/** Byte offsets of the `BITMAPINFOHEADER` fields this decoder reads (from the header start). */
const DIB_BIWIDTH_OFFSET = 4;
const DIB_BIHEIGHT_OFFSET = 8;
const DIB_BITCOUNT_OFFSET = 14;
const DIB_COMPRESSION_OFFSET = 16;
const DIB_CLRUSED_OFFSET = 32;

/** Rounds a byte count up to the next 4-byte boundary (DIB rows are 32-bit aligned). */
const align4 = (n: number): number => (n + 3) & ~3;

/** A decoded cursor: its pixels (straight RGBA) plus the size and hotspot the renderer needs. */
export interface DecodedCursor {
  readonly width: number;
  readonly height: number;
  /** Hotspot in pixels from the top-left — where the click actually lands (CSS `cursor: url() x y`). */
  readonly hotspotX: number;
  readonly hotspotY: number;
  readonly image: RgbaImage;
}

/** Little-endian views over one entry's directory fields (already sliced to its 16 bytes). */
interface DirEntry {
  readonly hotspotX: number;
  readonly hotspotY: number;
  readonly imageOffset: number;
}

/**
 * Decodes a `.cur` into straight RGBA, choosing the highest-colour-depth image in the directory and
 * taking transparency from its AND mask. Throws a `cursor:`-prefixed error on a structurally invalid
 * container or an unsupported pixel format (a batch walk should wrap the call per-file). The hotspot is
 * read from the selected (highest-depth) entry, so it is consistent with the decoded image.
 */
export function decodeCursor(bytes: Uint8Array): DecodedCursor {
  if (bytes.length < ICONDIR_BYTES) {
    throw new Error(`cursor: buffer of ${bytes.length} bytes is too short for the ICONDIR header`);
  }
  const view = viewOf(bytes);
  const type = view.getUint16(2, true);
  if (type !== RES_TYPE_CURSOR && type !== RES_TYPE_ICON) {
    throw new Error(`cursor: not a cursor/icon (ICONDIR type ${type}, expected 1 or 2)`);
  }
  const count = view.getUint16(4, true);
  if (count === 0) throw new Error('cursor: directory has no images');
  if (ICONDIR_BYTES + count * ICONDIRENTRY_BYTES > bytes.length) {
    throw new Error(`cursor: directory of ${count} entries overruns the buffer`);
  }

  const entries: DirEntry[] = [];
  for (let i = 0; i < count; i++) {
    const base = ICONDIR_BYTES + i * ICONDIRENTRY_BYTES;
    entries.push({
      hotspotX: view.getUint16(base + 4, true),
      hotspotY: view.getUint16(base + 6, true),
      imageOffset: view.getUint32(base + 12, true),
    });
  }

  // Pick the richest image: highest bit depth, then largest area (earlier entry breaks a full tie).
  let best = -1;
  let bestBits = -1;
  let bestArea = -1;
  for (let i = 0; i < count; i++) {
    const off = entries[i]?.imageOffset ?? 0;
    if (off + DIB_HEADER_BYTES > bytes.length) continue;
    const bitCount = view.getUint16(off + DIB_BITCOUNT_OFFSET, true);
    const width = view.getInt32(off + DIB_BIWIDTH_OFFSET, true);
    const height = Math.trunc(view.getInt32(off + DIB_BIHEIGHT_OFFSET, true) / 2); // biHeight = XOR + AND, so halve it
    const area = width * height;
    if (bitCount > bestBits || (bitCount === bestBits && area > bestArea)) {
      best = i;
      bestBits = bitCount;
      bestArea = area;
    }
  }
  if (best < 0) throw new Error('cursor: no image entry has a readable DIB header');

  // Decode the selected entry and take the hotspot from that same entry (not entry 0's lower-depth
  // fallback), matching the original's Win32 best-fit, which uses the selected image's own hotspot.
  const chosen = entries[best] as DirEntry;
  const image = decodeDib(bytes, view, chosen.imageOffset);
  return {
    width: image.width,
    height: image.height,
    hotspotX: chosen.hotspotX,
    hotspotY: chosen.hotspotY,
    image,
  };
}

/**
 * Decodes one bottom-up `BITMAPINFOHEADER` DIB (the cursor's XOR colour bitmap + 1-bpp AND mask) at
 * `off` into straight RGBA. Supports the paletted (≤8-bpp) and true-colour (24/32-bpp) `BI_RGB` forms
 * the game's cursors use; a set AND-mask bit makes a pixel fully transparent. Throws on an unsupported
 * bit depth or a truncated pixel stream.
 */
function decodeDib(bytes: Uint8Array, view: DataView, off: number): RgbaImage {
  const width = view.getInt32(off + DIB_BIWIDTH_OFFSET, true);
  const height = Math.trunc(view.getInt32(off + DIB_BIHEIGHT_OFFSET, true) / 2);
  const bitCount = view.getUint16(off + DIB_BITCOUNT_OFFSET, true);
  const compression = view.getUint32(off + DIB_COMPRESSION_OFFSET, true);
  if (width <= 0 || height <= 0) throw new Error(`cursor: invalid DIB dimensions ${width}x${height}`);
  if (compression !== 0) throw new Error(`cursor: unsupported DIB compression ${compression} (only BI_RGB)`);
  if (bitCount !== 8 && bitCount !== 24 && bitCount !== 32) {
    throw new Error(`cursor: unsupported bit depth ${bitCount} (only 8/24/32-bpp implemented)`);
  }

  // Palette (BGRA quads) for paletted DIBs; true-colour DIBs carry the colour inline.
  const paletted = bitCount <= 8;
  const clrUsed = view.getUint32(off + DIB_CLRUSED_OFFSET, true);
  const numColors = paletted ? clrUsed || 1 << bitCount : 0;
  const paletteStart = off + DIB_HEADER_BYTES;
  const xorStart = paletteStart + numColors * 4;

  const xorRowBytes = align4(Math.ceil((bitCount * width) / 8));
  const andRowBytes = align4(Math.ceil(width / 8));
  const andStart = xorStart + xorRowBytes * height;
  if (andStart + andRowBytes * height > bytes.length) {
    throw new Error(`cursor: DIB pixel stream is truncated for ${width}x${height} @ ${bitCount}bpp`);
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y; // rows are stored bottom-up
    const xorRow = xorStart + srcY * xorRowBytes;
    const andRow = andStart + srcY * andRowBytes;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const andBit = ((bytes[andRow + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
      if (andBit !== 0) continue; // AND set → transparent; leave RGBA all-zero
      let r = 0;
      let g = 0;
      let b = 0;
      if (bitCount === 8) {
        const p = paletteStart + (bytes[xorRow + x] ?? 0) * 4;
        b = bytes[p] ?? 0;
        g = bytes[p + 1] ?? 0;
        r = bytes[p + 2] ?? 0;
      } else {
        // 24/32-bpp true-colour: BGR(A) inline. A 32-bpp DIB's per-pixel alpha is ignored — the AND
        // mask governs transparency here (the shipped cursors are 8-bpp, so this branch never runs on
        // real data; it's a defensive path for a foreign true-colour cursor).
        const step = bitCount / 8;
        const p = xorRow + x * step;
        b = bytes[p] ?? 0;
        g = bytes[p + 1] ?? 0;
        r = bytes[p + 2] ?? 0;
      }
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = 0xff;
    }
  }
  return { width, height, rgba };
}

/** One 8-bpp image to serialize into a `.cur` for round-trip tests. */
export interface CursorImageInput {
  readonly width: number;
  readonly height: number;
  readonly hotspotX: number;
  readonly hotspotY: number;
  /** `width * height` palette indices, row-major top→bottom (the encoder flips to bottom-up on write). */
  readonly pixels: Uint8Array;
  /** 256 RGB triples (768 bytes) — written as the DIB's BGRA colour table. */
  readonly palette: Uint8Array;
  /** Optional `width * height` mask, 1 = transparent (sets the AND-mask bit); default all opaque. */
  readonly transparent?: Uint8Array;
}

/**
 * Serializes one or more 8-bpp images into a `.cur` byte stream — the faithful inverse of the 8-bpp
 * decode path, used to round-trip {@link decodeCursor} in tests without committing real cursor bytes.
 * The images share one directory; {@link decodeCursor} then selects among them exactly as it does a
 * real multi-depth cursor. Throws (`cursor:` prefix) on inputs that can't describe a valid image.
 */
export function encodeCursor(images: readonly CursorImageInput[]): Uint8Array {
  if (images.length === 0) throw new Error('cursor: need at least one image to encode');

  const dibs = images.map((img) => encodeDib8(img));
  const dirBytes = ICONDIR_BYTES + images.length * ICONDIRENTRY_BYTES;
  const total = dirBytes + dibs.reduce((sum, d) => sum + d.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, RES_TYPE_CURSOR, true);
  view.setUint16(4, images.length, true);

  let imageOffset = dirBytes;
  images.forEach((img, i) => {
    const base = ICONDIR_BYTES + i * ICONDIRENTRY_BYTES;
    out[base] = img.width & 0xff; // 0 encodes 256
    out[base + 1] = img.height & 0xff;
    out[base + 2] = 0; // colorCount (0 = ≥ 8bpp)
    out[base + 3] = 0; // reserved
    view.setUint16(base + 4, img.hotspotX, true);
    view.setUint16(base + 6, img.hotspotY, true);
    const dib = dibs[i] as Uint8Array;
    view.setUint32(base + 8, dib.length, true);
    view.setUint32(base + 12, imageOffset, true);
    out.set(dib, imageOffset);
    imageOffset += dib.length;
  });
  return out;
}

/** Builds one 8-bpp bottom-up DIB (header + 256-colour BGRA table + XOR bitmap + 1-bpp AND mask). */
function encodeDib8(img: CursorImageInput): Uint8Array {
  const { width, height, pixels, palette, transparent } = img;
  if (width <= 0 || height <= 0)
    throw new Error(`cursor: cannot encode invalid dimensions ${width}x${height}`);
  if (pixels.length !== width * height) {
    throw new Error(`cursor: pixels length ${pixels.length} does not match ${width}x${height}`);
  }
  assertPaletteBytes(palette, 'cursor');

  const xorRowBytes = align4(width);
  const andRowBytes = align4(Math.ceil(width / 8));
  const paletteBytes = 256 * 4;
  const out = new Uint8Array(DIB_HEADER_BYTES + paletteBytes + xorRowBytes * height + andRowBytes * height);
  const view = new DataView(out.buffer);

  view.setUint32(0, DIB_HEADER_BYTES, true); // biSize
  view.setInt32(4, width, true);
  view.setInt32(8, height * 2, true); // biHeight = XOR + AND
  view.setUint16(12, 1, true); // biPlanes
  view.setUint16(14, 8, true); // biBitCount
  view.setUint32(32, 256, true); // biClrUsed

  // Colour table: 256 BGRA quads from the RGB palette.
  for (let i = 0; i < 256; i++) {
    const s = i * 3;
    const d = DIB_HEADER_BYTES + i * 4;
    out[d] = palette[s + 2] ?? 0; // B
    out[d + 1] = palette[s + 1] ?? 0; // G
    out[d + 2] = palette[s] ?? 0; // R
    out[d + 3] = 0;
  }

  const xorStart = DIB_HEADER_BYTES + paletteBytes;
  const andStart = xorStart + xorRowBytes * height;
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y; // top→bottom input to bottom-up DIB
    for (let x = 0; x < width; x++) {
      out[xorStart + srcY * xorRowBytes + x] = pixels[y * width + x] ?? 0;
      if (transparent?.[y * width + x]) {
        const andIdx = andStart + srcY * andRowBytes + (x >> 3);
        out[andIdx] = (out[andIdx] ?? 0) | (1 << (7 - (x & 7)));
      }
    }
  }
  return out;
}
