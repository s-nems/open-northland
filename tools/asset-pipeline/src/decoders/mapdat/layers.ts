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
 *   +0x0D u32  unpackedLength = the decoded byte count (= element count × element width)
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

const X8EL_BYTES_PER_CELL = 1;
const X6EL_BYTES_PER_CELL = 2;

type PckCodecId = typeof MAP_LAYER_CODEC_X8 | typeof MAP_LAYER_CODEC_X6;

/**
 * One element width of the shared `pck` grammar. `TCells` only unifies when the array a caller
 * supplies is the one this codec allocates, so a stream cannot be unpacked at the wrong width.
 */
interface PckCodec<TCells extends Uint8Array | Uint16Array> {
  readonly id: PckCodecId;
  readonly bytesPerElement: typeof X8EL_BYTES_PER_CELL | typeof X6EL_BYTES_PER_CELL;
  readonly allocateCells: (elementCount: number) => TCells;
}

const X8EL: PckCodec<Uint8Array> = {
  id: MAP_LAYER_CODEC_X8,
  bytesPerElement: X8EL_BYTES_PER_CELL,
  allocateCells: (elementCount) => new Uint8Array(elementCount),
};

const X6EL: PckCodec<Uint16Array> = {
  id: MAP_LAYER_CODEC_X6,
  bytesPerElement: X6EL_BYTES_PER_CELL,
  allocateCells: (elementCount) => new Uint16Array(elementCount),
};

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

/** Fills every element of `cells` from the RLE stream starting at {@link MAP_LAYER_HEADER_SIZE}. */
function unpackRle<TCells extends Uint8Array | Uint16Array>(
  payload: Uint8Array,
  cells: TCells,
  codec: PckCodec<TCells>,
  tag: string,
): void {
  const { bytesPerElement } = codec;
  const elementCount = cells.length;
  const unpackedLength = elementCount * bytesPerElement;
  // Explicit little-endian composition, so a stream decodes the same on a big-endian host. A single
  // reader holding the width branch keeps this call site monomorphic on the corpus-wide decode loop.
  const readElement = (at: number): number =>
    bytesPerElement === X8EL_BYTES_PER_CELL
      ? (payload[at] as number)
      : (payload[at] as number) | ((payload[at + 1] as number) << 8);

  let o = 0;
  let i = MAP_LAYER_HEADER_SIZE;
  while (o < elementCount) {
    if (i >= payload.length) {
      throw new Error(
        `mapdat: layer "${tag}" stream underran (${o * bytesPerElement}/${unpackedLength} bytes) before its end`,
      );
    }
    const b = payload[i++] as number;
    if ((b & 0x80) !== 0) {
      const count = b & 0x7f;
      if (i + bytesPerElement > payload.length) {
        throw new Error(
          `mapdat: layer "${tag}" run control at end of stream has no ${bytesPerElement}-byte value`,
        );
      }
      const value = readElement(i);
      i += bytesPerElement;
      if (o + count > elementCount) {
        throw new Error(
          `mapdat: layer "${tag}" run overflows the ${unpackedLength}-byte grid (corrupt stream)`,
        );
      }
      cells.fill(value, o, o + count);
      o += count;
    } else {
      const count = b;
      if (i + count * bytesPerElement > payload.length) {
        throw new Error(`mapdat: layer "${tag}" literal run reads past the stream end (corrupt/truncated)`);
      }
      if (o + count > elementCount) {
        throw new Error(
          `mapdat: layer "${tag}" literal overflows the ${unpackedLength}-byte grid (corrupt stream)`,
        );
      }
      for (let k = 0; k < count; k++) {
        cells[o++] = readElement(i);
        i += bytesPerElement;
      }
    }
  }
}

/**
 * Emits the RLE control stream for `cells`, without the inner header. Runs of two or more identical
 * elements become a run control, everything else a literal run, both capped at 0x7F. The original
 * generator's exact run and literal boundaries are not reproduced; only recovering the input grid
 * through {@link unpackRle} is pinned.
 */
function packRle<TCells extends Uint8Array | Uint16Array>(cells: TCells, codec: PckCodec<TCells>): number[] {
  const { bytesPerElement } = codec;
  const elementCount = cells.length;
  const stream: number[] = [];
  const pushElement = (value: number): void => {
    stream.push(value & 0xff);
    if (bytesPerElement === X6EL_BYTES_PER_CELL) stream.push((value >>> 8) & 0xff);
  };

  let i = 0;
  while (i < elementCount) {
    const value = cells[i] as number;
    let run = 1;
    while (run < 0x7f && i + run < elementCount && cells[i + run] === value) run++;
    if (run >= 2) {
      stream.push(0x80 | run);
      pushElement(value);
      i += run;
    } else {
      const litStart = i;
      let lit = 0;
      while (lit < 0x7f && i < elementCount && !(i + 1 < elementCount && cells[i + 1] === cells[i])) {
        i++;
        lit++;
      }
      // Always make progress: a lone element before a run becomes a 1-literal.
      if (lit === 0) {
        i++;
        lit = 1;
      }
      stream.push(lit);
      for (let k = 0; k < lit; k++) pushElement(cells[litStart + k] as number);
    }
  }
  return stream;
}

/** Validates the packed-layer marker and codec id, returning the declared unpacked byte length. */
function readLayerHeader(chunk: MapDatChunk, expectedCodec: PckCodecId): number {
  if (!isPackedLayer(chunk)) {
    throw new Error(
      `mapdat: chunk "${chunk.tag}" is not a pck-packed layer (no "${MAP_LAYER_MARKER}" marker)`,
    );
  }
  const payload = chunk.payload;
  const codec = ascii(payload, 0x08, 4);
  if (codec !== expectedCodec) {
    throw new Error(`mapdat: chunk "${chunk.tag}" codec "${codec}" is not an ${expectedCodec} layer`);
  }
  return viewOf(payload).getUint32(0x0d, true);
}

/** Unpacks a `pck` layer chunk at one codec's element width, throwing on header or stream corruption. */
function unpackLayerCells<TCells extends Uint8Array | Uint16Array>(
  chunk: MapDatChunk,
  codec: PckCodec<TCells>,
): TCells {
  const unpackedLength = readLayerHeader(chunk, codec.id);
  if (unpackedLength % codec.bytesPerElement !== 0) {
    throw new Error(
      `mapdat: layer "${chunk.tag}" unpacked length ${unpackedLength} is not a whole number of ${codec.bytesPerElement}-byte elements`,
    );
  }
  const cells = codec.allocateCells(unpackedLength / codec.bytesPerElement);
  unpackRle(chunk.payload, cells, codec, chunk.tag);
  return cells;
}

/**
 * Writes a layer payload: the 21-byte inner header followed by the packed stream. Kept faithful so the
 * unpackers can be round-trip tested without committing copyrighted fixtures.
 */
function packLayerPayload<TCells extends Uint8Array | Uint16Array>(
  cells: TCells,
  codec: PckCodec<TCells>,
  version: number,
): Uint8Array {
  const stream = packRle(cells, codec);
  const innerSize = 16 + stream.length; // bytes after the +0x01 innerSize field
  const out = new Uint8Array(5 + innerSize);
  const view = new DataView(out.buffer);
  out[0x00] = version & 0xff;
  view.setUint32(0x01, innerSize, true);
  out.set(asciiBytes(MAP_LAYER_MARKER), 0x05);
  out.set(asciiBytes(codec.id), 0x08);
  out[0x0c] = MAP_LAYER_SUBFORMAT;
  view.setUint32(0x0d, cells.length * codec.bytesPerElement, true);
  view.setUint32(0x11, innerSize, true);
  out.set(stream, MAP_LAYER_HEADER_SIZE);
  return out;
}

/** Unpacks a `pck`/`X8el` grid layer chunk into its row-major byte grid. */
export function unpackMapLayer(chunk: MapDatChunk): MapLayer {
  return { codec: MAP_LAYER_CODEC_X8, cells: unpackLayerCells(chunk, X8EL) };
}

/** Inverse of {@link unpackMapLayer}. */
export function packMapLayer(cells: Uint8Array, version = 1): Uint8Array {
  return packLayerPayload(cells, X8EL, version);
}

/**
 * Unpacks an `X6el` grid layer into its row-major u16 grid. Byte-level inspection of owned maps shows
 * its inner header is identical to the `X8el` one and only the RLE stream differs, operating on 2-byte
 * little-endian elements.
 */
export function unpackX6elLayer(chunk: MapDatChunk): MapLayerU16 {
  return { codec: MAP_LAYER_CODEC_X6, cells: unpackLayerCells(chunk, X6EL) };
}

/** Inverse of {@link unpackX6elLayer}. */
export function packX6elLayer(cells: Uint16Array, version = 1): Uint8Array {
  return packLayerPayload(cells, X6EL, version);
}
