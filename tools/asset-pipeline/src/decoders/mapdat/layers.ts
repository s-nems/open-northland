/**
 * `map.dat` packed grid layers — the `pck` RLE format in its two element widths: `X8el` (one byte
 * per element: `lmhe` height, `lmlt` landscape-object typeIds) and `X6el` (little-endian u16 per
 * element: `empa`/`empb` ground-pattern picks, `emla` object placements).
 *
 * The grid layer payloads are not raw byte arrays — they are RLE-packed and open with a 21-byte
 * inner header (all u32s little-endian, offsets from the chunk payload start):
 *
 *   +0x00 u8   version        (observed 1)
 *   +0x01 u32  innerSize      = payloadLength - 5 (every byte after this field)
 *   +0x05 "pck"               on-disk bytes "kcp" (the {@link MAP_LAYER_MARKER}, reversed like a tag)
 *   +0x08 "X8el" | "X6el"     the codec id; the trailing 8/6 is the per-pixel bit depth
 *   +0x0C u8   subFormat      observed constant 0x72 ({@link MAP_LAYER_SUBFORMAT})
 *   +0x0D u32  unpackedLength = the decoded byte count (= cells × bytesPerCell)
 *   +0x11 u32  innerSize      (the +0x01 value repeated)
 *   +0x15 …    the RLE stream, running to the end of the payload
 *
 * The RLE stream (the same packed-line family as the `.bmd` codec, `CBobManager.cs`, with the
 * raw/run roles swapped): each control byte `b` is either a **run** (high bit set) of `count =
 * b & 0x7F` copies of the single element that follows, or a **literal** (high bit clear) run of
 * `count = b` elements copied verbatim. `X8el` and `X6el` share this stream grammar exactly and
 * differ ONLY in element width, so both directions route through one codec parameterized by
 * {@link elementBytes} — {@link unpackRle}/{@link packRle}. Decoding stops at exactly the declared
 * unpacked byte length.
 */

import { asciiBytes, LATIN1 } from '../byte-cursor.js';
import type { MapDatChunk } from './container.js';

export const MAP_LAYER_HEADER_SIZE = 0x15;
/** "pck" as it appears on disk ("kcp", reversed like the chunk tags), at inner offset +0x05. */
export const MAP_LAYER_MARKER = 'kcp';
/** The 8-bit-per-cell codec id at inner offset +0x08. */
export const MAP_LAYER_CODEC_X8 = 'X8el';
/** The 6-bit codec id (entity-ownership layers); recognized but not unpacked here. */
export const MAP_LAYER_CODEC_X6 = 'X6el';
/** The constant sub-format byte at inner offset +0x0C (observed 0x72 on every real layer). */
export const MAP_LAYER_SUBFORMAT = 0x72;
/** Bytes one `X8el` element occupies unpacked (a single byte). */
const X8EL_BYTES_PER_CELL = 1;
/**
 * The number of bytes one `X6el` element occupies in the unpacked grid (a little-endian u16). The
 * `empa`/`empb` ground-pattern lanes carry one element per map CELL (unpacked length exactly
 * `width × height × 2`); `emla` carries one per HALF-CELL (`2W × 2H` elements).
 */
const X6EL_BYTES_PER_CELL = 2;

/** A decoded packed grid layer: its codec id and the unpacked row-major byte grid. */
export interface MapLayer {
  /** The codec id from the inner header (always `"X8el"` — the byte-per-element planes). */
  readonly codec: typeof MAP_LAYER_CODEC_X8;
  /** The decoded bytes (`unpackedLength` long, row-major over the grid). */
  readonly cells: Uint8Array;
}

/** A decoded `X6el` layer: the little-endian u16 elements, row-major. */
export interface MapLayerU16 {
  /** The codec id from the inner header (always `"X6el"`). */
  readonly codec: typeof MAP_LAYER_CODEC_X6;
  /**
   * One u16 per grid element, row-major. For `empa`/`empb` an index into the map's `eapd` pattern
   * dictionary; for `emla` an index into `eald` (0xffff = no object).
   */
  readonly cells: Uint16Array;
}

/** Reads "pck"/"kcp" or a codec id from the layer header as ASCII (Latin1 is exact for these). */
function ascii(payload: Uint8Array, offset: number, length: number): string {
  return LATIN1.decode(payload.subarray(offset, offset + length));
}

/**
 * Returns true if a chunk's payload is a `pck`-packed grid layer (carries the `"kcp"` marker). The
 * raw `lsiz` chunk and the structured record-list chunks (`eatd`,`eald`,…) are not packed and return
 * false. Use to filter the chunk table before {@link unpackMapLayer}.
 */
export function isPackedLayer(chunk: MapDatChunk): boolean {
  return chunk.length >= MAP_LAYER_HEADER_SIZE && ascii(chunk.payload, 0x05, 3) === MAP_LAYER_MARKER;
}

/**
 * Shared RLE decode for both element widths. Fills every element of `out` from the stream starting
 * at {@link MAP_LAYER_HEADER_SIZE}, composing each element from `elementBytes` little-endian bytes.
 * `out` is a `Uint8Array` (X8el, `elementBytes` 1) or a `Uint16Array` (X6el, `elementBytes` 2); the
 * value is composed explicitly LE (`lo | hi<<8`) before it is stored, so it decodes identically on a
 * big-endian host (never a byte-reinterpreting `Uint16Array` view over the raw stream). Throws a
 * `<tag>`-labelled error on any stream corruption (underrun, run/literal overflow, truncated read).
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
  let i = MAP_LAYER_HEADER_SIZE; // the RLE stream starts right after the inner header
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
 * Shared RLE encode for both element widths: emits the packed control stream (not the inner header).
 * Runs of ≥2 identical elements become a run control (capped at 0x7F per run); everything else is a
 * literal run (also capped at 0x7F). The exact packing the original generator chose is not
 * byte-reproduced (a packer has freedom in run/literal boundaries) — what is pinned is that
 * {@link unpackRle} recovers the input grid exactly.
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
    // Measure the run of identical elements at i.
    let run = 1;
    while (run < 0x7f && i + run < elementCount && get(i + run) === value) run++;
    if (run >= 2) {
      stream.push(0x80 | run);
      pushValue(value);
      i += run;
    } else {
      // Gather a literal run until the next element that starts a worthwhile run (≥2) or the cap.
      const litStart = i;
      let lit = 0;
      while (lit < 0x7f && i < elementCount && !(i + 1 < elementCount && get(i + 1) === get(i))) {
        i++;
        lit++;
      }
      // Guard: always make progress (a lone element before a run becomes a 1-literal).
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
  out.set(asciiBytes(MAP_LAYER_MARKER), 0x05); // "kcp"
  out.set(asciiBytes(codec), 0x08); // "X8el" | "X6el"
  out[0x0c] = MAP_LAYER_SUBFORMAT;
  view.setUint32(0x0d, unpackedLength, true);
  view.setUint32(0x11, innerSize, true);
  out.set(stream, MAP_LAYER_HEADER_SIZE);
  return out;
}

/**
 * Validates the packed-layer marker + codec id, returning the declared unpacked byte length. The
 * codec-mismatch message differs per codec (`is not supported` vs `is not an X6el layer`), so the
 * caller supplies it as a builder over the found codec.
 */
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
  const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
  return view.getUint32(0x0d, true);
}

/**
 * Unpacks a `pck`/`X8el` grid layer chunk into its row-major byte grid.
 *
 * Throws on a non-packed chunk (no `"kcp"` marker), a codec that isn't `X8el` (the `X6el`
 * u16 ownership layers go through {@link unpackX6elLayer}), or a stream that underruns before
 * producing `unpackedLength` bytes (a corrupt/truncated layer). A batch pipeline over owned files
 * should wrap this per-chunk so one bad layer can't abort the run (mirrors `decodeMapDat`'s per-file
 * contract).
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
 * fixtures (same rationale as the `.cif`/`.lib`/`.bmd` encoders).
 */
export function packMapLayer(cells: Uint8Array, version = 1): Uint8Array {
  const stream = packRle(cells.length, (index) => cells[index] as number, X8EL_BYTES_PER_CELL);
  return encodeLayerPayload(stream, MAP_LAYER_CODEC_X8, cells.length, version);
}

/**
 * Unpacks an `X6el` grid layer (`empa`/`empb` ground-pattern picks, `emla` object placements) into
 * its row-major **u16** grid. The container header is byte-identical to {@link unpackMapLayer}'s
 * `X8el` header, but the RLE stream operates on 2-byte little-endian elements (reverse-engineered
 * from real maps — the oracle decodes the container but not the layer codecs).
 *
 * Throws on a non-packed chunk, a codec that isn't `X6el`, an odd declared length (not whole u16s),
 * or a stream that underruns/overflows its declared length (a corrupt/truncated layer). A batch
 * pipeline should wrap this per-chunk so one bad layer can't abort the run (mirrors the X8el path).
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
 * Inverse of {@link unpackX6elLayer}: RLE-packs a row-major u16 ownership grid into an `X6el` chunk
 * payload. Kept faithful so the unpacker can be round-trip tested without committing copyrighted
 * fixtures (same rationale as the X8el packer).
 */
export function packX6elLayer(cells: Uint16Array, version = 1): Uint8Array {
  const stream = packRle(cells.length, (index) => cells[index] as number, X6EL_BYTES_PER_CELL);
  return encodeLayerPayload(stream, MAP_LAYER_CODEC_X6, cells.length * X6EL_BYTES_PER_CELL, version);
}
