/**
 * PNG container encoder/decoder — wraps straight 8-bit RGBA pixels in a PNG file (and reads them back).
 *
 * Unlike the other decoders this ports no original game format: PNG is the pipeline's OUTPUT container.
 * `decodePcx` (and later `decodeBmd`) produce indexed pixels → `expandToRgba` → `encodePng` → a `.png`
 * written under content/. The byte layout follows the PNG spec (W3C / ISO 15948):
 *   signature 89 50 4E 47 0D 0A 1A 0A, then length-prefixed CRC-32'd chunks IHDR, IDAT(s), IEND
 *   (all multi-byte fields big-endian).
 * We emit the simplest conformant stream: 8-bit colour-type-6 (truecolour + alpha), no interlace, every
 * scanline prefixed with filter type 0 (None), the whole filtered image zlib-deflated as one IDAT.
 * `decodePng` is the inverse, used to round-trip `encodePng` without committing real assets — it parses
 * the same minimal shape, verifies each chunk CRC, and reconstructs filter-0 rows. Foreign PNGs that use
 * the other four row filters (1..4) are rejected with a clear `png:` error rather than silently corrupted;
 * the oracle pixel-diff step can extend it to read those when it actually needs to.
 *
 * Pure functions (no I/O): bytes in, bytes out. zlib is via node:zlib — this is an offline build tool,
 * not the deterministic sim, so Node APIs are fair game here.
 */

import { deflateSync, inflateSync } from 'node:zlib';
import type { RgbaImage } from './pcx.js';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_BYTES = 13;
const BIT_DEPTH = 8;
const COLOR_TYPE_RGBA = 6;
const CHANNELS = 4; // R,G,B,A — bytes per pixel at 8-bit colour type 6
const FILTER_NONE = 0;

// CRC-32 (ISO 3309, reflected, polynomial 0xEDB88320) over chunk type + data, per the PNG spec.
const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Serializes one PNG chunk: `[u32 length][4-byte ASCII type][data][u32 CRC]` (CRC over type + data). */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false);
  return out;
}

/**
 * Encodes straight 8-bit RGBA pixels into a PNG (colour type 6, no interlace, filter-0 scanlines, one
 * zlib-deflated IDAT). Throws a `png:`-prefixed error on dimensions that don't describe a valid image or
 * an `rgba` buffer whose length disagrees with them — programmer errors, not recoverable boundary cases.
 */
export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, rgba } = image;
  if (width <= 0 || height <= 0) {
    throw new Error(`png: cannot encode invalid dimensions ${width}x${height}`);
  }
  if (rgba.length !== width * height * CHANNELS) {
    throw new Error(
      `png: rgba length ${rgba.length} does not match ${width}x${height}x${CHANNELS} = ${width * height * CHANNELS}`,
    );
  }

  const stride = width * CHANNELS;
  // Each scanline is prefixed with its filter-type byte (0 = None); the row-0 bytes stay zero-filled.
  const filtered = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    filtered.set(rgba.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1);
  }
  const idat = new Uint8Array(deflateSync(filtered));

  const ihdr = new Uint8Array(IHDR_BYTES);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width, false);
  hv.setUint32(4, height, false);
  ihdr[8] = BIT_DEPTH;
  ihdr[9] = COLOR_TYPE_RGBA;
  // bytes 10..12 (compression / filter / interlace methods) stay 0.

  const ihdrChunk = chunk('IHDR', ihdr);
  const idatChunk = chunk('IDAT', idat);
  const iendChunk = chunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let p = 0;
  for (const part of [SIGNATURE, ihdrChunk, idatChunk, iendChunk]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/**
 * Inverse of {@link encodePng}: parses the minimal shape we emit and returns straight RGBA. Throws a
 * `png:`-prefixed error on a bad signature, a chunk that overruns the buffer, a CRC mismatch, a header
 * we don't support (non-8-bit, non-RGBA, interlaced), a non-None row filter, or a truncated pixel
 * stream. These are malformed/unsupported inputs — a boundary failure the caller should surface per-file.
 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  if (bytes.length < SIGNATURE.length || !signatureMatches(bytes)) {
    throw new Error('png: not a PNG (bad signature)');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let sawHeader = false;
  const idatParts: Uint8Array[] = [];

  let off = SIGNATURE.length;
  while (off + 8 <= bytes.length) {
    const length = view.getUint32(off, false);
    const type = String.fromCharCode(
      bytes[off + 4] ?? 0,
      bytes[off + 5] ?? 0,
      bytes[off + 6] ?? 0,
      bytes[off + 7] ?? 0,
    );
    const dataStart = off + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) {
      throw new Error(`png: ${type} chunk overruns the buffer`);
    }
    const expectedCrc = view.getUint32(dataEnd, false);
    if (crc32(bytes.subarray(off + 4, dataEnd)) !== expectedCrc) {
      throw new Error(`png: CRC mismatch in ${type} chunk`);
    }

    if (type === 'IHDR') {
      if (length !== IHDR_BYTES) throw new Error(`png: IHDR must be ${IHDR_BYTES} bytes, got ${length}`);
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      const bitDepth = bytes[dataStart + 8] ?? 0;
      const colorType = bytes[dataStart + 9] ?? 0;
      const interlace = bytes[dataStart + 12] ?? 0;
      if (bitDepth !== BIT_DEPTH || colorType !== COLOR_TYPE_RGBA || interlace !== 0) {
        throw new Error(
          `png: unsupported header (bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}); only 8-bit RGBA non-interlaced is implemented`,
        );
      }
      if (width <= 0 || height <= 0) throw new Error(`png: invalid dimensions ${width}x${height}`);
      sawHeader = true;
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }

    off = dataEnd + 4;
  }

  if (!sawHeader) throw new Error('png: missing IHDR chunk');
  if (idatParts.length === 0) throw new Error('png: missing IDAT data');

  const filtered: Uint8Array = inflateSync(concat(idatParts));
  const stride = width * CHANNELS;
  if (filtered.length < height * (stride + 1)) {
    throw new Error(
      `png: pixel stream too short (${filtered.length} < ${height * (stride + 1)} for ${width}x${height})`,
    );
  }

  const rgba = new Uint8Array(width * height * CHANNELS);
  for (let y = 0; y < height; y++) {
    const filter = filtered[y * (stride + 1)] ?? 0;
    if (filter !== FILTER_NONE) {
      throw new Error(`png: unsupported row filter ${filter} (only None/0 implemented)`);
    }
    const from = y * (stride + 1) + 1;
    rgba.set(filtered.subarray(from, from + stride), y * stride);
  }

  return { width, height, rgba };
}

function signatureMatches(bytes: Uint8Array): boolean {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) return false;
  }
  return true;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
