/**
 * `map.dat` packed grid layers: the `pck` RLE format in its two element widths, `X8el` (one byte per
 * element) and `X6el` (little-endian u16 per element).
 *
 * A layer payload opens with a 21-byte inner header, u32s little-endian, offsets from the chunk
 * payload start:
 *
 *   +0x00 u8   version        (observed 1)
 *   +0x01 u32  innerSize      = payloadLength - 5 (every byte after this field)
 *   +0x05 "pck"               on-disk bytes "kcp", reversed like a chunk tag
 *   +0x08 "X8el" | "X6el"     the codec id; the trailing 8/6 is the per-element bit depth
 *   +0x0C u8   subFormat      observed constant 0x72
 *   +0x0D u32  unpackedLength = the decoded byte count (= elements × elementBytes)
 *   +0x11 u32  innerSize      (the +0x01 value repeated)
 *   +0x15 …    the RLE stream, running to the end of the payload
 *
 * Each control byte `b` is either a run (high bit set) of `b & 0x7F` copies of the single element that
 * follows, or a literal (high bit clear) run of `b` elements copied verbatim. Both codecs share this
 * grammar and differ only in element width. Decoding stops at the declared unpacked byte length.
 */

import { asciiBytes, decodeLatin1, viewOf } from '../byte-cursor.js';
import type { MapDatChunk } from './container.js';

export const MAP_LAYER_HEADER_SIZE = 0x15;
/** "pck" as it appears on disk ("kcp", reversed like the chunk tags), at inner offset +0x05. */
const MAP_LAYER_MARKER = 'kcp';
/** The 8-bit-per-cell codec id at inner offset +0x08. */
export const MAP_LAYER_CODEC_X8 = 'X8el';
/** The u16-per-element codec id at inner offset +0x08. */
export const MAP_LAYER_CODEC_X6 = 'X6el';
/** The constant sub-format byte at inner offset +0x0C (observed 0x72 on every real layer). */
export const MAP_LAYER_SUBFORMAT = 0x72;
/** Bytes one `X8el` element occupies unpacked (a single byte). */
const X8EL_BYTES_PER_CELL = 1;
/** Bytes one `X6el` element occupies unpacked (a little-endian u16). */
const X6EL_BYTES_PER_CELL = 2;

export interface MapLayer {
  readonly codec: typeof MAP_LAYER_CODEC_X8;
  /** The decoded bytes, `unpackedLength` long and row-major over the grid. */
  readonly cells: Uint8Array;
}

export interface MapLayerU16 {
  readonly codec: typeof MAP_LAYER_CODEC_X6;
  /**
   * One u16 per grid element, row-major. For `empa`/`empb` an index into the map's `eapd` pattern
   * dictionary; for `emla` an index into `eald` (0xffff = no object).
   */
  readonly cells: Uint16Array;
}

/** Reads a fixed-length ASCII field of the layer header (Latin-1 is exact for these). */
function ascii(payload: Uint8Array, offset: number, length: number): string {
  return decodeLatin1(payload.subarray(offset, offset + length));
}

/**
 * True when a chunk's payload is a `pck`-packed grid layer, carrying the `"kcp"` marker. The raw
 * `lsiz` chunk and the record-list chunks (`eatd`, `eald`, …) are not packed.
 */
export function isPackedLayer(chunk: MapDatChunk): boolean {
  return chunk.length >= MAP_LAYER_HEADER_SIZE && ascii(chunk.payload, 0x05, 3) === MAP_LAYER_MARKER;
}

/**
 * Shared RLE decode for both element widths, filling every element of `out` from the stream that
 * starts at {@link MAP_LAYER_HEADER_SIZE}. Each value is composed explicitly little-endian
 * (`lo | hi<<8`) rather than through a byte-reinterpreting view, so it decodes identically on a
 * big-endian host. Throws a `<tag>`-labelled error on any stream corruption.
 */
function unpackRle(p: Uint8Array, out: Uint8Array | Uint16Array, elementBytes: number, tag: string): void {
  const elementCount = out.length;
  const unpackedLength = elementCount * elementBytes;
  const valueNoun = elementBytes === X8EL_BYTES_PER_CELL ? 'byte' : 'element';
  const readElement = (at: number): number =>
    elementBytes === X8EL_BYTES_PER_CELL
      ? (p[at] as number)
      : (p[at] as number) | ((p[at + 1] as number) << 8);

  let o = 0;
  let i = MAP_LAYER_HEADER_SIZE;
  while (o < elementCount) {
    if (i >= p.length) {
      throw new Error(
        `mapdat: layer "${tag}" stream underran (${o * elementBytes}/${unpackedLength} bytes) before its end`,
      );
    }
    const b = p[i++] as number;
    if ((b & 0x80) !== 0) {
      // Run: (b & 0x7F) copies of the next element.
      const count = b & 0x7f;
      if (i + elementBytes > p.length) {
        throw new Error(`mapdat: layer "${tag}" run control at end of stream has no value ${valueNoun}`);
      }
      const value = readElement(i);
      i += elementBytes;
      if (o + count > elementCount) {
        throw new Error(
          `mapdat: layer "${tag}" run overflows the ${unpackedLength}-byte grid (corrupt stream)`,
        );
      }
      out.fill(value, o, o + count);
      o += count;
    } else {
      // Literal: b elements copied verbatim (each little-endian).
      const count = b;
      if (i + count * elementBytes > p.length) {
        throw new Error(`mapdat: layer "${tag}" literal run reads past the stream end (corrupt/truncated)`);
      }
      if (o + count > elementCount) {
        throw new Error(
          `mapdat: layer "${tag}" literal overflows the ${unpackedLength}-byte grid (corrupt stream)`,
        );
      }
      for (let k = 0; k < count; k++) {
        out[o++] = readElement(i);
        i += elementBytes;
      }
    }
  }
}

/**
 * Shared RLE encode for both element widths, emitting the control stream without the inner header.
 * Runs of two or more identical elements become a run control, everything else a literal run, both
 * capped at 0x7F. The original generator's exact run and literal boundaries are not reproduced; only
 * recovering the input grid through {@link unpackRle} is pinned.
 */
function packRle(elementCount: number, get: (index: number) => number, elementBytes: number): number[] {
  const stream: number[] = [];
  const pushValue = (v: number): void => {
    stream.push(v & 0xff);
    if (elementBytes === X6EL_BYTES_PER_CELL) stream.push((v >>> 8) & 0xff);
  };

  let i = 0;
  while (i < elementCount) {
    const value = get(i);
    let run = 1;
    while (run < 0x7f && i + run < elementCount && get(i + run) === value) run++;
    if (run >= 2) {
      stream.push(0x80 | run);
      pushValue(value);
      i += run;
    } else {
      const litStart = i;
      let lit = 0;
      while (lit < 0x7f && i < elementCount && !(i + 1 < elementCount && get(i + 1) === get(i))) {
        i++;
        lit++;
      }
      // Always make progress: a lone element before a run becomes a 1-literal.
      if (lit === 0) {
        i++;
        lit = 1;
      }
      stream.push(lit);
      for (let k = 0; k < lit; k++) pushValue(get(litStart + k));
    }
  }
  return stream;
}

/** Writes the 21-byte inner header + the packed stream (shared by both codecs). */
function encodeLayerPayload(
  stream: readonly number[],
  codec: string,
  unpackedLength: number,
  version: number,
): Uint8Array {
  const innerSize = 16 + stream.length; // bytes after the +0x01 innerSize field
  const out = new Uint8Array(5 + innerSize);
  const view = new DataView(out.buffer);
  out[0x00] = version & 0xff;
  view.setUint32(0x01, innerSize, true);
  out.set(asciiBytes(MAP_LAYER_MARKER), 0x05);
  out.set(asciiBytes(codec), 0x08);
  out[0x0c] = MAP_LAYER_SUBFORMAT;
  view.setUint32(0x0d, unpackedLength, true);
  view.setUint32(0x11, innerSize, true);
  out.set(stream, MAP_LAYER_HEADER_SIZE);
  return out;
}

/** Validates the packed-layer marker and codec id, returning the declared unpacked byte length. */
function readLayerHeader(
  chunk: MapDatChunk,
  expectedCodec: string,
  mismatchMessage: (foundCodec: string) => string,
): number {
  const p = chunk.payload;
  if (!isPackedLayer(chunk)) {
    throw new Error(
      `mapdat: chunk "${chunk.tag}" is not a pck-packed layer (no "${MAP_LAYER_MARKER}" marker)`,
    );
  }
  const codec = ascii(p, 0x08, 4);
  if (codec !== expectedCodec) {
    throw new Error(mismatchMessage(codec));
  }
  const view = viewOf(p);
  return view.getUint32(0x0d, true);
}

/**
 * Unpacks a `pck`/`X8el` grid layer chunk into its row-major byte grid. Throws on a non-packed chunk,
 * a codec other than `X8el`, or a stream that underruns its declared `unpackedLength`.
 */
export function unpackMapLayer(chunk: MapDatChunk): MapLayer {
  const unpackedLength = readLayerHeader(
    chunk,
    MAP_LAYER_CODEC_X8,
    (codec) => `mapdat: chunk "${chunk.tag}" codec "${codec}" is not supported (only ${MAP_LAYER_CODEC_X8})`,
  );
  const cells = new Uint8Array(unpackedLength);
  unpackRle(chunk.payload, cells, X8EL_BYTES_PER_CELL, chunk.tag);
  return { codec: MAP_LAYER_CODEC_X8, cells };
}

/**
 * Inverse of {@link unpackMapLayer}: RLE-packs a row-major byte grid into a `pck`/`X8el` chunk
 * payload. Kept faithful so the unpacker can be round-trip tested without committing copyrighted
 * fixtures.
 */
export function packMapLayer(cells: Uint8Array, version = 1): Uint8Array {
  const stream = packRle(cells.length, (index) => cells[index] as number, X8EL_BYTES_PER_CELL);
  return encodeLayerPayload(stream, MAP_LAYER_CODEC_X8, cells.length, version);
}

/**
 * Unpacks an `X6el` grid layer into its row-major u16 grid. Byte-level inspection of owned maps shows
 * its inner header is identical to the `X8el` one and only the RLE stream differs, operating on
 * 2-byte little-endian elements. Throws on a non-packed chunk, a codec other than `X6el`, an odd
 * declared length, or a stream that underruns or overflows that length.
 */
export function unpackX6elLayer(chunk: MapDatChunk): MapLayerU16 {
  const unpackedLength = readLayerHeader(
    chunk,
    MAP_LAYER_CODEC_X6,
    (codec) => `mapdat: chunk "${chunk.tag}" codec "${codec}" is not an ${MAP_LAYER_CODEC_X6} layer`,
  );
  if (unpackedLength % X6EL_BYTES_PER_CELL !== 0) {
    throw new Error(
      `mapdat: layer "${chunk.tag}" unpacked length ${unpackedLength} is not a whole number of u16 cells`,
    );
  }
  const cells = new Uint16Array(unpackedLength / X6EL_BYTES_PER_CELL);
  unpackRle(chunk.payload, cells, X6EL_BYTES_PER_CELL, chunk.tag);
  return { codec: MAP_LAYER_CODEC_X6, cells };
}

/**
 * Inverse of {@link unpackX6elLayer}: RLE-packs a row-major u16 grid into an `X6el` chunk payload.
 * Kept faithful so the unpacker can be round-trip tested without committing copyrighted fixtures.
 */
export function packX6elLayer(cells: Uint16Array, version = 1): Uint8Array {
  const stream = packRle(cells.length, (index) => cells[index] as number, X6EL_BYTES_PER_CELL);
  return encodeLayerPayload(stream, MAP_LAYER_CODEC_X6, cells.length * X6EL_BYTES_PER_CELL, version);
}
