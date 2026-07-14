/**
 * `.pcx` picture decoder — palette-indexed RLE images, plus the embedded 256-color palette.
 *
 * Ported format (not architecture) from OpenVikings `Source/NXBasics/`:
 *   - CPicture.cs  `UnpackPCX` (header fields, per-row RLE, trailing palette)
 *   - CPalette.cs  256 RGB entries (the on-disk PCX trailer is RGB triples, not CPalette's BGRx)
 * Referenced at OpenVikings_reversing @ working tree 2026-06.
 *
 * Layout (header is 128 bytes, all multi-byte fields little-endian):
 *   u8  manufacturer (0x0A)   u8 version   u8 encoding (1 = RLE)   u8 bitsPerPixel (8)
 *   u16 xMin @4   u16 yMin @6   u16 xMax @8   u16 yMax @10   ...   (rest unused by the decode)
 *   ... RLE-encoded pixel rows from offset 0x80
 *   [optional] u8 0x0C marker + 256×3 RGB palette as the final 769 bytes.
 *
 * width = xMax - xMin + 1, height = yMax - yMin + 1. Like the original we decode each row into a
 * scanline of `(width + 1) & ~1` bytes (the even-aligned width — the game's pictures are single-plane
 * 8bpp, so this equals the header `bytesPerLine`) and keep the first `width` of them. RLE: a byte
 * < 0xC0 is a literal; a byte >= 0xC0 is a run of `(byte & 0x3F)` copies of the following byte. Runs
 * never cross a scanline boundary (a run overflowing the row is truncated there, as the original does).
 *
 * Palette detection differs from the original in one deliberate, result-equal way: OpenVikings reads
 * the trailing 768 bytes whenever the file is >= 769 bytes (its 0x0C marker check is a dead branch).
 * We honor the standard 0x0C marker at `length - 769` instead — every real game `.pcx` carries it, so
 * decoded pixels/palette are identical, but a palette-less buffer no longer yields a bogus palette.
 *
 * Pure functions only (no I/O): `(bytes) => decoded`. The CLI wires file reads + PNG output around
 * them. `encodePcx` is the faithful inverse, used to round-trip test without committing real assets.
 */

import { assertPaletteBytes, PALETTE_RGB_BYTES, paletteToRgba, type RgbaImage } from './image.js';

const HEADER_BYTES = 0x80;
const PALETTE_TRAILER_BYTES = 1 + PALETTE_RGB_BYTES; // 0x0C marker + 256 RGB triples
const PALETTE_MARKER = 0x0c;

/** A decoded `.pcx`: indexed pixels plus the embedded palette (if the file carried one). */
export interface PcxImage {
  readonly width: number;
  readonly height: number;
  /** Row-major (top→bottom) palette indices, length `width * height`. */
  readonly pixels: Uint8Array;
  /** 256 RGB triples (768 bytes), or `undefined` if the file had no 256-color trailer. */
  readonly palette: Uint8Array | undefined;
}

/**
 * Decodes a `.pcx` into indexed pixels and its embedded palette. Throws a `pcx:`-prefixed error on a
 * structurally invalid header (too short, or non-positive dimensions) — a batch pipeline should wrap
 * each call per-file so one bad picture can't abort the run. Truncated pixel data is tolerated (the
 * remaining pixels keep whatever the reused scanline buffer last held), matching the original decoder.
 */
export function decodePcx(bytes: Uint8Array): PcxImage {
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`pcx: buffer of ${bytes.length} bytes is too short for the 128-byte header`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const xMin = view.getUint16(4, true);
  const yMin = view.getUint16(6, true);
  const xMax = view.getUint16(8, true);
  const yMax = view.getUint16(10, true);

  const width = xMax - xMin + 1;
  const height = yMax - yMin + 1;
  if (width <= 0 || height <= 0) {
    throw new Error(
      `pcx: invalid dimensions ${width}x${height} (xMin=${xMin} xMax=${xMax} yMin=${yMin} yMax=${yMax})`,
    );
  }

  const alignedRowBytes = (width + 1) & ~1;
  const pixels = new Uint8Array(width * height);
  // Reused across rows and intentionally NOT cleared: well-formed data refills it fully each row;
  // truncated data leaks the previous row's tail, exactly as the original's shared rowBuffer does.
  const row = new Uint8Array(alignedRowBytes);
  let src = HEADER_BYTES;

  for (let y = 0; y < height; y++) {
    let written = 0;
    while (written < alignedRowBytes && src < bytes.length) {
      const value = view.getUint8(src);
      if (value < 0xc0) {
        row[written++] = value;
        src += 1;
      } else {
        const count = value & 0x3f;
        if (src + 1 >= bytes.length) break;
        const fill = view.getUint8(src + 1);
        for (let k = 0; k < count && written < alignedRowBytes; k++) row[written++] = fill;
        src += 2;
      }
    }
    pixels.set(row.subarray(0, width), y * width);
  }

  let palette: Uint8Array | undefined;
  if (
    bytes.length >= PALETTE_TRAILER_BYTES &&
    view.getUint8(bytes.length - PALETTE_TRAILER_BYTES) === PALETTE_MARKER
  ) {
    palette = bytes.slice(bytes.length - PALETTE_RGB_BYTES); // owned copy of the 256 RGB triples
  }

  return { width, height, pixels, palette };
}

/**
 * Expands indexed pixels to straight RGBA using the image's palette. Indices are bytes and a valid
 * palette has 256 entries, so an index is never out of range. Throws (with a `pcx:` prefix, like
 * {@link encodePcx}) if the image has no palette or one that isn't exactly 256 RGB triples — a
 * decoded image always satisfies this, so a throw means a hand-built `PcxImage`.
 */
export function expandToRgba(image: PcxImage): RgbaImage {
  const { width, height, pixels, palette } = image;
  if (palette === undefined) {
    throw new Error('pcx: cannot expand to RGBA — image has no palette');
  }
  assertPaletteBytes(palette, 'pcx');
  // A `.pcx` picture is fully opaque — every pixel written, alpha 0xff.
  return { width, height, rgba: paletteToRgba(pixels, palette, () => 0xff) };
}

/** What {@link encodePcx} serializes: the dimensions, indexed pixels, and an optional palette. */
export interface PcxImageInput {
  readonly width: number;
  readonly height: number;
  /** `width * height` palette indices, row-major (top→bottom). */
  readonly pixels: Uint8Array;
  /** 256 RGB triples (768 bytes). Omit to write a picture with no palette trailer. */
  readonly palette?: Uint8Array;
}

/**
 * Inverse of {@link decodePcx}: serializes a single-plane 8bpp `.pcx` with per-row RLE and (if given)
 * a 0x0C-marked 256-color trailer. Kept faithful so decode can be round-tripped without committing
 * copyrighted fixtures (same rationale as the `.lib`/`.cif` encoder pairs). Throws on inputs that
 * can't describe a valid picture (these are programmer errors, not recoverable boundary failures).
 */
export function encodePcx(input: PcxImageInput): Uint8Array {
  const { width, height, pixels, palette } = input;
  if (width <= 0 || height <= 0) {
    throw new Error(`pcx: cannot encode invalid dimensions ${width}x${height}`);
  }
  if (pixels.length !== width * height) {
    throw new Error(
      `pcx: pixels length ${pixels.length} does not match ${width}x${height} = ${width * height}`,
    );
  }
  if (palette !== undefined) assertPaletteBytes(palette, 'pcx');

  const alignedRowBytes = (width + 1) & ~1;
  const out: number[] = [];

  const header = new Uint8Array(HEADER_BYTES);
  const hv = new DataView(header.buffer);
  header[0] = 0x0a; // manufacturer
  header[1] = 5; // version: 3.0 with palette
  header[2] = 1; // encoding: RLE
  header[3] = 8; // bits per pixel
  hv.setUint16(8, width - 1, true); // xMax (xMin stays 0)
  hv.setUint16(10, height - 1, true); // yMax (yMin stays 0)
  header[65] = 1; // color planes
  hv.setUint16(66, alignedRowBytes, true); // bytes per line
  hv.setUint16(68, 1, true); // palette type: color
  for (const b of header) out.push(b);

  const rowBuf = new Uint8Array(alignedRowBytes);
  for (let y = 0; y < height; y++) {
    rowBuf.fill(0); // pad byte (odd widths) is encoded but discarded on decode
    rowBuf.set(pixels.subarray(y * width, y * width + width));
    let i = 0;
    while (i < alignedRowBytes) {
      const cur = rowBuf[i] ?? 0;
      let run = 1;
      while (i + run < alignedRowBytes && (rowBuf[i + run] ?? 0) === cur && run < 0x3f) run++;
      if (run > 1 || cur >= 0xc0) {
        out.push(0xc0 | run, cur);
      } else {
        out.push(cur);
      }
      i += run;
    }
  }

  if (palette !== undefined) {
    out.push(PALETTE_MARKER);
    for (const b of palette) out.push(b);
  }

  return Uint8Array.from(out);
}
