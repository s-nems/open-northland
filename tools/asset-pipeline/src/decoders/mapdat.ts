/**
 * `map.dat` container decoder — the Cultures engine's `hoix`-chunk file (the sibling of `map.cif`
 * that carries the binary per-cell landscape grid + entity/object map; `map.cif` is only the
 * logic-header `CStringArray`).
 *
 * Ported FORMAT (not architecture) from OpenVikings `Source/NC2Logic/CIoHelper.cs`
 * (`SIoHelperChunk` / `IO_File_Chunk_*` / `FlipSIoHelperChunk`). Referenced @ working tree 2026-06.
 *
 * On-disk layout: a flat sequence of chunks, each a **0x20-byte little-endian header** then
 * `length` payload bytes, read sequentially to EOF:
 *
 *   +0x00 u32 marker   = 0x78696F68 ("hoix")
 *   +0x04 u32 id       = a 4-char subtag, stored low->high (disk bytes "zisl" => tag "lsiz")
 *   +0x08 u32 version
 *   +0x0C u32 length   = payload size in bytes (0 for bracket/group chunks)
 *   +0x10 u32 depth    = nesting level (groups bracket sub-chunks; original MaxChunkDepth=5)
 *   +0x14 u32 checksum = XB_GetMemoryChecksum of the payload (not validated here)
 *   +0x18 u32 / +0x1C u32 reserved
 *
 * Group/bracket chunks (`logi`,`lgmm`,`emmm`) and the `xend`/`tend` terminators carry length 0;
 * their sub-chunks follow immediately, so a single `offset += 0x20 + length` walk visits every
 * chunk — `depth` merely records the nesting. The original reads one group at a time and stops at
 * `xend` (`IO_File_Chunk_ReadHeader` returns false on id 0x78656E64); for a flat tag table we keep
 * walking to EOF and record the terminators too.
 *
 * This module decodes the **container** (the chunk table) plus the one *raw* payload, `lsiz`
 * (`[u32 width][u32 height]`, the grid dims that cross-check the `map.cif` `mapsize`), the
 * **`pck`/`X8el` packed byte grid layers** (`lmhe`,`lmlt`,`lmpa`,…) via {@link unpackMapLayer},
 * the **`X6el` u16 grid layers** (`empa`/`empb` = the per-triangle ground-pattern picks, `emla` =
 * the placed landscape objects) via {@link unpackX6elLayer}, and the **name-dictionary chunks**
 * (`eapd`/`eald`/`eatd`) via {@link decodeStringListChunk}. The grid layers are RLE-packed planes
 * opening with a small inner header (see below); `X8el` packs single bytes, `X6el` the same RLE
 * family over little-endian u16 elements. `findChunk` still exposes every chunk's raw payload view.
 *
 * Pure functions only (no I/O): `(bytes) => decoded`. The CLI wires file reads around them.
 */

/** "hoix" little-endian — the chunk marker every header opens with. */
export const HOIX_MARKER = 0x78696f68;
/** Chunk header length: marker, id, version, length, depth, checksum, 2 reserved (8 × u32). */
export const CHUNK_HEADER_SIZE = 0x20;
/** "xend" little-endian (disk bytes "dnex") — a group terminator chunk. */
export const XEND_ID = 0x78656e64;
/** "tend" little-endian (disk bytes "dnet") — the top-level terminator chunk. */
export const TEND_ID = 0x74656e64;

/** Latin1 maps all 256 byte values 1:1; chunk tags are ASCII so this is exact. */
const LATIN1 = new TextDecoder('latin1');

/** One `hoix` chunk: its parsed header and a zero-copy view of its payload. */
export interface MapDatChunk {
  /** Raw u32 id as stored on disk (low->high bytes). */
  readonly id: number;
  /**
   * Human-readable 4-char tag: the id bytes reversed (disk "zisl" => "lsiz"). This is the form the
   * format docs and the layer-selection logic use.
   */
  readonly tag: string;
  readonly version: number;
  /** Payload size in bytes (0 for group/terminator chunks). */
  readonly length: number;
  /** Nesting level recorded in the header (groups bracket their sub-chunks). */
  readonly depth: number;
  /** Checksum field as stored (XB_GetMemoryChecksum of the payload; not validated here). */
  readonly checksum: number;
  /** Absolute byte offset of the payload from the start of the file. */
  readonly payloadOffset: number;
  /** View into the source buffer over `[payloadOffset, payloadOffset + length)` — not a copy. */
  readonly payload: Uint8Array;
}

/** A decoded `map.dat`: the flat chunk table in file order. */
export interface MapDat {
  readonly chunks: readonly MapDatChunk[];
}

/** The `lsiz` grid dimensions (cells = width × height, row-major). */
export interface MapDatSize {
  readonly width: number;
  readonly height: number;
}

/** A raw u32 id (low->high disk bytes) to its reversed 4-char ASCII tag ("zisl" => "lsiz"). */
function idToTag(id: number): string {
  const b0 = id & 0xff;
  const b1 = (id >>> 8) & 0xff;
  const b2 = (id >>> 16) & 0xff;
  const b3 = (id >>> 24) & 0xff;
  return LATIN1.decode(Uint8Array.of(b3, b2, b1, b0));
}

/** A 4-char ASCII tag ("lsiz") to its raw u32 id (the disk bytes are the tag reversed). */
export function tagToId(tag: string): number {
  if (tag.length !== 4) throw new Error(`mapdat: tag "${tag}" must be exactly 4 chars`);
  const b0 = tag.charCodeAt(3) & 0xff; // last tag char is the low disk byte
  const b1 = tag.charCodeAt(2) & 0xff;
  const b2 = tag.charCodeAt(1) & 0xff;
  const b3 = tag.charCodeAt(0) & 0xff;
  return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
}

/**
 * Decodes a `map.dat` container into its flat chunk table. Walks every chunk to EOF (including the
 * `xend`/`tend` terminators) by `offset += CHUNK_HEADER_SIZE + length`.
 *
 * Throws on a structurally invalid container — a header whose marker is not `hoix`, or a payload
 * that overruns the buffer. A batch pipeline over many owned files should wrap this per-file so one
 * corrupt `map.dat` can't abort the run (mirrors `decodeLib`).
 */
export function decodeMapDat(bytes: Uint8Array): MapDat {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: MapDatChunk[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    if (offset + CHUNK_HEADER_SIZE > bytes.length) {
      throw new Error(`mapdat: chunk header at offset ${offset} overruns buffer of ${bytes.length} bytes`);
    }
    const marker = view.getUint32(offset, true);
    if (marker !== HOIX_MARKER) {
      throw new Error(`mapdat: expected hoix marker at offset ${offset}, got 0x${marker.toString(16)}`);
    }
    const id = view.getUint32(offset + 0x04, true);
    const version = view.getUint32(offset + 0x08, true);
    const length = view.getUint32(offset + 0x0c, true);
    const depth = view.getUint32(offset + 0x10, true);
    const checksum = view.getUint32(offset + 0x14, true);

    const payloadOffset = offset + CHUNK_HEADER_SIZE;
    if (payloadOffset + length > bytes.length) {
      throw new Error(
        `mapdat: chunk "${idToTag(id)}" payload [${payloadOffset}, ${payloadOffset + length}) overruns buffer of ${bytes.length} bytes`,
      );
    }

    chunks.push({
      id,
      tag: idToTag(id),
      version,
      length,
      depth,
      checksum,
      payloadOffset,
      payload: bytes.subarray(payloadOffset, payloadOffset + length),
    });

    offset = payloadOffset + length;
  }

  return { chunks };
}

/** Returns the first chunk with the given tag (file order), or undefined if absent. */
export function findChunk(map: MapDat, tag: string): MapDatChunk | undefined {
  return map.chunks.find((c) => c.tag === tag);
}

/**
 * Decodes the `lsiz` chunk's raw `[u32 width][u32 height]` grid dimensions. These cross-check the
 * `map.cif` logic-header `mapsize` exactly (confirmed on real maps). Throws if `lsiz` is missing or
 * its payload isn't the expected 8 bytes — a `map.dat` with no grid is malformed.
 */
export function decodeMapSize(map: MapDat): MapDatSize {
  const chunk = findChunk(map, 'lsiz');
  if (chunk === undefined) {
    throw new Error('mapdat: no lsiz chunk (cannot determine grid dimensions)');
  }
  if (chunk.length !== 8) {
    throw new Error(`mapdat: lsiz payload is ${chunk.length} bytes, expected 8 (u32 width+height)`);
  }
  const view = new DataView(chunk.payload.buffer, chunk.payload.byteOffset, chunk.payload.byteLength);
  return { width: view.getUint32(0, true), height: view.getUint32(4, true) };
}

/** One chunk to serialize: its tag plus the raw payload bytes (header fields are derived/defaulted). */
export interface MapDatChunkInput {
  readonly tag: string;
  readonly version?: number;
  readonly depth?: number;
  readonly checksum?: number;
  readonly payload?: Uint8Array;
}

/**
 * Inverse of {@link decodeMapDat}: serializes a `map.dat` from a chunk list, laying each header +
 * payload sequentially. Kept faithful so decode can be round-trip tested without committing
 * copyrighted fixtures (the same rationale as the `.cif`/`.lib` encoders). The `checksum` field is
 * written as given (default 0) — this encoder does not recompute the engine's payload checksum, and
 * the decoder does not validate it, so round-trips are exact.
 */
export function encodeMapDat(chunks: readonly MapDatChunkInput[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += CHUNK_HEADER_SIZE + (c.payload?.length ?? 0);

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = 0;
  for (const c of chunks) {
    const payload = c.payload ?? new Uint8Array(0);
    view.setUint32(p + 0x00, HOIX_MARKER, true);
    view.setUint32(p + 0x04, tagToId(c.tag), true);
    view.setUint32(p + 0x08, (c.version ?? 0) >>> 0, true);
    view.setUint32(p + 0x0c, payload.length, true);
    view.setUint32(p + 0x10, (c.depth ?? 0) >>> 0, true);
    view.setUint32(p + 0x14, (c.checksum ?? 0) >>> 0, true);
    // +0x18 / +0x1C reserved — left zero.
    out.set(payload, p + CHUNK_HEADER_SIZE);
    p += CHUNK_HEADER_SIZE + payload.length;
  }
  return out;
}

/** Serializes an `lsiz` payload: `[u32 width][u32 height]`. Helper for building test fixtures. */
export function encodeMapSize(size: MapDatSize): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, size.width >>> 0, true);
  view.setUint32(4, size.height >>> 0, true);
  return out;
}

// ---------------------------------------------------------------------------
// Packed per-cell grid layers (the `pck` / `X8el` RLE format)
// ---------------------------------------------------------------------------

/**
 * The grid layer payloads (`lmhe`,`lmlt`,`lmpa`,…) are not raw byte arrays — they are RLE-packed and
 * open with a 21-byte inner header (all u32s little-endian, offsets from the chunk payload start):
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
 * b & 0x7F` copies of the single byte that follows, or a **literal** (high bit clear) run of `count
 * = b` bytes copied verbatim. Decoding stops at exactly `unpackedLength` output bytes, which (on
 * every real `X8el` layer probed) consumes the stream exactly to the payload end.
 *
 * `X8el` = one byte per output element (e.g. `lmhe` height, 1 B per CELL; `lmlt` landscape-object
 * typeIds, 1 B per HALF-CELL of the row-major `2W × 2H` lattice — see {@link HALF_CELLS_PER_CELL});
 * `X6el` (`empa`/`empb` per-cell ground-pattern picks, `emla` per-half-cell object ids) packs the
 * same RLE family over little-endian u16 elements — decoded by {@link unpackX6elLayer}.
 */
export const MAP_LAYER_HEADER_SIZE = 0x15;
/** "pck" as it appears on disk ("kcp", reversed like the chunk tags), at inner offset +0x05. */
export const MAP_LAYER_MARKER = 'kcp';
/** The 8-bit-per-cell codec id at inner offset +0x08. */
export const MAP_LAYER_CODEC_X8 = 'X8el';
/** The 6-bit codec id (entity-ownership layers); recognized but not unpacked here. */
export const MAP_LAYER_CODEC_X6 = 'X6el';
/** The constant sub-format byte at inner offset +0x0C (observed 0x72 on every real layer). */
export const MAP_LAYER_SUBFORMAT = 0x72;

/** A decoded packed grid layer: its codec id and the unpacked row-major byte grid. */
export interface MapLayer {
  /** The codec id from the inner header (e.g. `"X8el"`). */
  readonly codec: string;
  /** The decoded bytes (`unpackedLength` long, row-major over the grid). */
  readonly cells: Uint8Array;
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
 * Unpacks a `pck`/`X8el` grid layer chunk into its row-major byte grid.
 *
 * Throws on a non-packed chunk (no `"kcp"` marker), a codec that isn't `X8el` (the `X6el`
 * u16 ownership layers go through {@link unpackX6elLayer}), or a stream that underruns before
 * producing `unpackedLength` bytes (a corrupt/truncated layer). A batch pipeline over owned files
 * should wrap this per-chunk so one bad layer can't abort the run (mirrors `decodeMapDat`'s per-file
 * contract).
 */
export function unpackMapLayer(chunk: MapDatChunk): MapLayer {
  const p = chunk.payload;
  if (!isPackedLayer(chunk)) {
    throw new Error(
      `mapdat: chunk "${chunk.tag}" is not a pck-packed layer (no "${MAP_LAYER_MARKER}" marker)`,
    );
  }
  const codec = ascii(p, 0x08, 4);
  if (codec !== MAP_LAYER_CODEC_X8) {
    throw new Error(
      `mapdat: chunk "${chunk.tag}" codec "${codec}" is not supported (only ${MAP_LAYER_CODEC_X8})`,
    );
  }
  const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const unpackedLength = view.getUint32(0x0d, true);

  const out = new Uint8Array(unpackedLength);
  let o = 0;
  let i = MAP_LAYER_HEADER_SIZE; // the RLE stream starts right after the inner header
  while (o < unpackedLength) {
    if (i >= p.length) {
      throw new Error(
        `mapdat: layer "${chunk.tag}" stream underran (${o}/${unpackedLength} bytes) before its end`,
      );
    }
    const b = p[i++] as number;
    if ((b & 0x80) !== 0) {
      // Run: (b & 0x7F) copies of the next byte.
      const count = b & 0x7f;
      if (i >= p.length) {
        throw new Error(`mapdat: layer "${chunk.tag}" run control at end of stream has no value byte`);
      }
      const value = p[i++] as number;
      if (o + count > unpackedLength) {
        throw new Error(
          `mapdat: layer "${chunk.tag}" run overflows the ${unpackedLength}-byte grid (corrupt stream)`,
        );
      }
      out.fill(value, o, o + count);
      o += count;
    } else {
      // Literal: copy b bytes verbatim.
      if (i + b > p.length) {
        throw new Error(
          `mapdat: layer "${chunk.tag}" literal run reads past the stream end (corrupt/truncated)`,
        );
      }
      if (o + b > unpackedLength) {
        throw new Error(
          `mapdat: layer "${chunk.tag}" literal overflows the ${unpackedLength}-byte grid (corrupt stream)`,
        );
      }
      out.set(p.subarray(i, i + b), o);
      o += b;
      i += b;
    }
  }
  return { codec, cells: out };
}

/**
 * Inverse of {@link unpackMapLayer}: RLE-packs a row-major byte grid into a `pck`/`X8el` chunk
 * payload (the 21-byte inner header + the packed stream). Kept faithful so the unpacker can be
 * round-trip tested without committing copyrighted fixtures (same rationale as the `.cif`/`.lib`/
 * `.bmd` encoders). Runs of ≥2 identical bytes become a run control (capped at 0x7F per run);
 * everything else is emitted as literal runs (also capped at 0x7F). The exact packing the original
 * generator chose is not byte-reproduced (a packer has freedom in run/literal boundaries) — what is
 * pinned is that {@link unpackMapLayer} recovers the input grid exactly.
 */
export function packMapLayer(cells: Uint8Array, version = 1): Uint8Array {
  const stream: number[] = [];
  let i = 0;
  while (i < cells.length) {
    const value = cells[i] as number;
    // Measure the run of identical bytes at i.
    let run = 1;
    while (run < 0x7f && i + run < cells.length && cells[i + run] === value) run++;
    if (run >= 2) {
      stream.push(0x80 | run, value);
      i += run;
    } else {
      // Gather a literal run until the next byte that starts a worthwhile run (≥2) or the cap.
      const litStart = i;
      let lit = 0;
      while (lit < 0x7f && i < cells.length && !(i + 1 < cells.length && cells[i + 1] === cells[i])) {
        i++;
        lit++;
      }
      // Guard: always make progress (a lone byte before a run becomes a 1-literal).
      if (lit === 0) {
        i++;
        lit = 1;
      }
      stream.push(lit);
      for (let k = 0; k < lit; k++) stream.push(cells[litStart + k] as number);
    }
  }

  const innerSize = 16 + stream.length; // bytes after the +0x01 innerSize field
  const out = new Uint8Array(5 + innerSize);
  const view = new DataView(out.buffer);
  out[0x00] = version & 0xff;
  view.setUint32(0x01, innerSize, true);
  out.set(LATIN1ish(MAP_LAYER_MARKER), 0x05); // "kcp"
  out.set(LATIN1ish(MAP_LAYER_CODEC_X8), 0x08); // "X8el"
  out[0x0c] = MAP_LAYER_SUBFORMAT;
  view.setUint32(0x0d, cells.length, true);
  view.setUint32(0x11, innerSize, true);
  out.set(stream, MAP_LAYER_HEADER_SIZE);
  return out;
}

/** Encodes an ASCII string to bytes (the marker/codec ids are ASCII; 1:1 with Latin1). */
function LATIN1ish(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// ---------------------------------------------------------------------------
// `X6el` packed grid layers (the 2-byte-per-cell entity-ownership planes)
// ---------------------------------------------------------------------------

/**
 * The number of bytes one `X6el` element occupies in the unpacked grid (a little-endian u16). The
 * `empa`/`empb` ground-pattern lanes carry one element per map CELL (unpacked length exactly
 * `width × height × 2`); `emla` carries one per HALF-CELL (`2W × 2H` elements).
 */
export const X6EL_BYTES_PER_CELL = 2;

/** A decoded `X6el` layer: the little-endian u16 elements, row-major. */
export interface MapLayerU16 {
  /** The codec id from the inner header (always `"X6el"`). */
  readonly codec: string;
  /**
   * One u16 per grid element, row-major. For `empa`/`empb` an index into the map's `eapd` pattern
   * dictionary; for `emla` an index into `eald` (0xffff = no object).
   */
  readonly cells: Uint16Array;
}

/**
 * Unpacks an `X6el` grid layer (`empa`/`empb` ground-pattern picks, `emla` object placements) into
 * its row-major **u16** grid.
 *
 * The container header is byte-identical to {@link unpackMapLayer}'s `X8el` header (21-byte inner
 * header: version, "kcp" marker, codec id, sub-format 0x72, the u32 unpacked **byte** length), but
 * the RLE stream operates on **2-byte elements**, not single bytes (reverse-engineered from real
 * maps — the oracle decodes the container but not the layer codecs):
 *
 *  - a control byte with the high bit **set** is a run of `count = b & 0x7F` copies of the **next two
 *    bytes** (one little-endian u16 value);
 *  - a control byte with the high bit **clear** is a literal run of `count = b` u16 elements (the
 *    next `count × 2` bytes), each read little-endian.
 *
 * Decoding stops at exactly the declared unpacked byte length (which consumes the stream to the
 * payload end on every real layer). The unpacked byte length is even by construction (= cells × 2).
 *
 * Throws on a non-packed chunk, a codec that isn't `X6el`, an odd declared length (not whole u16s),
 * or a stream that underruns/overflows its declared length (a corrupt/truncated layer). A batch
 * pipeline should wrap this per-chunk so one bad layer can't abort the run (mirrors the X8el path).
 */
export function unpackX6elLayer(chunk: MapDatChunk): MapLayerU16 {
  const p = chunk.payload;
  if (!isPackedLayer(chunk)) {
    throw new Error(
      `mapdat: chunk "${chunk.tag}" is not a pck-packed layer (no "${MAP_LAYER_MARKER}" marker)`,
    );
  }
  const codec = ascii(p, 0x08, 4);
  if (codec !== MAP_LAYER_CODEC_X6) {
    throw new Error(`mapdat: chunk "${chunk.tag}" codec "${codec}" is not an ${MAP_LAYER_CODEC_X6} layer`);
  }
  const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const unpackedLength = view.getUint32(0x0d, true);
  if (unpackedLength % X6EL_BYTES_PER_CELL !== 0) {
    throw new Error(
      `mapdat: layer "${chunk.tag}" unpacked length ${unpackedLength} is not a whole number of u16 cells`,
    );
  }

  // Accumulate directly into a u16 grid, composing each element **explicitly little-endian** (`lo |
  // hi<<8`). NOT a `Uint16Array` view over a decoded byte buffer — that would read host-endian and
  // mis-decode on a big-endian host; the rest of this file already reads multi-byte fields LE-explicit.
  const cells = new Uint16Array(unpackedLength / X6EL_BYTES_PER_CELL);
  let o = 0; // index into `cells` (u16 elements written so far)
  const elementCount = cells.length;
  let i = MAP_LAYER_HEADER_SIZE; // the RLE stream starts right after the inner header
  while (o < elementCount) {
    if (i >= p.length) {
      throw new Error(
        `mapdat: layer "${chunk.tag}" stream underran (${o * X6EL_BYTES_PER_CELL}/${unpackedLength} bytes) before its end`,
      );
    }
    const b = p[i++] as number;
    if ((b & 0x80) !== 0) {
      // Run: (b & 0x7F) copies of the next u16 element (two bytes, little-endian).
      const count = b & 0x7f;
      if (i + X6EL_BYTES_PER_CELL > p.length) {
        throw new Error(`mapdat: layer "${chunk.tag}" run control at end of stream has no value element`);
      }
      const value = (p[i] as number) | ((p[i + 1] as number) << 8);
      i += X6EL_BYTES_PER_CELL;
      if (o + count > elementCount) {
        throw new Error(
          `mapdat: layer "${chunk.tag}" run overflows the ${unpackedLength}-byte grid (corrupt stream)`,
        );
      }
      cells.fill(value, o, o + count);
      o += count;
    } else {
      // Literal: b u16 elements copied verbatim (each little-endian).
      const count = b;
      if (i + count * X6EL_BYTES_PER_CELL > p.length) {
        throw new Error(
          `mapdat: layer "${chunk.tag}" literal run reads past the stream end (corrupt/truncated)`,
        );
      }
      if (o + count > elementCount) {
        throw new Error(
          `mapdat: layer "${chunk.tag}" literal overflows the ${unpackedLength}-byte grid (corrupt stream)`,
        );
      }
      for (let k = 0; k < count; k++) {
        cells[o++] = (p[i] as number) | ((p[i + 1] as number) << 8);
        i += X6EL_BYTES_PER_CELL;
      }
    }
  }
  return { codec, cells };
}

/**
 * Inverse of {@link unpackX6elLayer}: RLE-packs a row-major u16 ownership grid into an `X6el` chunk
 * payload (the 21-byte inner header + the packed stream). Kept faithful so the unpacker can be
 * round-trip tested without committing copyrighted fixtures (same rationale as the X8el packer).
 * Runs of ≥2 identical u16 elements become a run control (capped at 0x7F elements per run); the rest
 * are emitted as literal runs (also capped at 0x7F). The exact packing the original generator chose
 * is not byte-reproduced (a packer has freedom in run/literal boundaries) — what is pinned is that
 * {@link unpackX6elLayer} recovers the input grid exactly.
 */
export function packX6elLayer(cells: Uint16Array, version = 1): Uint8Array {
  const stream: number[] = [];
  let i = 0;
  while (i < cells.length) {
    const value = cells[i] as number;
    // Measure the run of identical elements at i.
    let run = 1;
    while (run < 0x7f && i + run < cells.length && cells[i + run] === value) run++;
    if (run >= 2) {
      stream.push(0x80 | run, value & 0xff, (value >>> 8) & 0xff);
      i += run;
    } else {
      // Gather a literal run until the next element that starts a worthwhile run (≥2) or the cap.
      const litStart = i;
      let lit = 0;
      while (lit < 0x7f && i < cells.length && !(i + 1 < cells.length && cells[i + 1] === cells[i])) {
        i++;
        lit++;
      }
      // Guard: always make progress (a lone element before a run becomes a 1-literal).
      if (lit === 0) {
        i++;
        lit = 1;
      }
      stream.push(lit);
      for (let k = 0; k < lit; k++) {
        const v = cells[litStart + k] as number;
        stream.push(v & 0xff, (v >>> 8) & 0xff);
      }
    }
  }

  const unpackedLength = cells.length * X6EL_BYTES_PER_CELL;
  const innerSize = 16 + stream.length; // bytes after the +0x01 innerSize field
  const out = new Uint8Array(5 + innerSize);
  const view = new DataView(out.buffer);
  out[0x00] = version & 0xff;
  view.setUint32(0x01, innerSize, true);
  out.set(LATIN1ish(MAP_LAYER_MARKER), 0x05); // "kcp"
  out.set(LATIN1ish(MAP_LAYER_CODEC_X6), 0x08); // "X6el"
  out[0x0c] = MAP_LAYER_SUBFORMAT;
  view.setUint32(0x0d, unpackedLength, true);
  view.setUint32(0x11, innerSize, true);
  out.set(stream, MAP_LAYER_HEADER_SIZE);
  return out;
}

// ---------------------------------------------------------------------------
// Half-cell landscape lanes (`lmlt`, `emla`, …) + the map's name dictionaries
// ---------------------------------------------------------------------------

/**
 * The landscape grid lanes (`lmlt`, `lmlv`, `emla`, …) carry 4 values per map cell — but NOT as
 * per-cell corner quads: each lane is a plain **row-major `2·width × 2·height` half-cell grid**
 * (pinned empirically: rendering `lmlt`/`emla` as a `2W × 2H` image draws the map's island shapes
 * cleanly, while a per-cell 2×2 interleave draws two side-by-side half-resolution copies — the tell
 * that consecutive values run along a `2W` row, not around one cell). A map cell (x, y) owns the four
 * half-cells `(2x, 2y)`, `(2x+1, 2y)`, `(2x, 2y+1)`, `(2x+1, 2y+1)`; landscape objects sit on this
 * finer lattice (`emla`), and `lmlt` mirrors each placed object's logic type onto it.
 */
export const HALF_CELLS_PER_CELL = 4;

/**
 * The `lmlt` value marking a half-cell with **no landscape object** (the lane's dominant value —
 * open ground/sea). Raw non-zero values are the IR `LandscapeType.typeId` **directly** (1-based, as
 * in the readable `landscapetypes.ini`): pinned by the `[GfxLandscape]` records' explicit `LogicType`
 * — e.g. every `"clay mine …"` object carries `LogicType 12` (`mud_mine`, typeId 12) and the probed
 * maps' clay half-cells hold raw `12` with matching counts (`palm` → `LogicType 4` = `tree`,
 * `"fx wave …"` → `LogicType 1` = `void`, exact count matches across lanes). An earlier reading
 * (+1-shifted 0-based indices) mapped every object one row off (tree → tree_falling) — see
 * source basis.
 */
export const LMLT_EMPTY = 0;

/**
 * The IR `LandscapeType.typeId` an empty half-cell reduces to: `void` (typeId 1) — the "nothing
 * here" landscape type, so a grid built from the lane always resolves against the IR table.
 */
export const VOID_TYPE_ID = 1;

/**
 * Reduces a cell's four half-cell values to a single representative: the **dominant** (most
 * frequent) value, ties broken by the **lowest** (canonical + deterministic — never depends on
 * half-cell order). On a uniform cell (all four equal, the common case) it returns that value; on a
 * mixed cell it returns whichever value covers most of the cell.
 *
 * Pure helper for {@link lmltToTerrainMap}; exported for direct unit testing of the reduction rule.
 */
export function reduceHalfCellsToCell(c0: number, c1: number, c2: number, c3: number): number {
  const values = [c0, c1, c2, c3];
  let best = c0;
  let bestCount = 0;
  for (const candidate of values) {
    let count = 0;
    for (const other of values) if (other === candidate) count++;
    // Strictly-greater keeps the first (lowest-index) winner; the lowest-value tie-break is applied
    // explicitly so the result never depends on which half-cell happened to come first.
    if (count > bestCount || (count === bestCount && candidate < best)) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** A raw per-cell landscape map: dimensions + a row-major typeId grid (the cell-graph input). */
export interface MapDatTerrainMap {
  readonly width: number;
  readonly height: number;
  /** Row-major landscape typeId per cell; length === width × height. */
  readonly typeIds: number[];
}

/**
 * Collapses an unpacked `lmlt` layer (the `2W × 2H` half-cell landscape-object lane) plus the `lsiz`
 * dimensions into a single per-cell landscape-typeId grid — the plain `{ width, height, typeIds }`
 * shape the sim's `buildTerrainGraph` (`packages/sim/src/terrain.ts`) consumes as a `TerrainMap`.
 * Each cell's type is the {@link reduceHalfCellsToCell} dominant of its 2×2 half-cell block; raw
 * values are the IR typeId directly ({@link LMLT_EMPTY} = no object → {@link VOID_TYPE_ID}). Returns
 * a plain value (not a sim type) so the build tool never imports from `sim`; the sim validates the
 * typeIds against its IR table.
 *
 * APPROXIMATED: the half-cell→cell reduction has no behavioral oracle (OpenVikings decodes the
 * container but does not simulate navigation). Dominant-value is a faithful-shaped, deterministic
 * choice for a bulk-terrain nav grid; refine if the oracle later pins a different rule. Walkability
 * itself is resolved downstream from the IR `LandscapeType` flags, not here.
 *
 * Throws if the layer length isn't exactly `width × height × 4` (a wrong layer / dims mismatch).
 */
export function lmltToTerrainMap(layer: MapLayer, size: MapDatSize): MapDatTerrainMap {
  const cells = size.width * size.height;
  const expected = cells * HALF_CELLS_PER_CELL;
  if (layer.cells.length !== expected) {
    throw new Error(
      `mapdat: lmlt layer has ${layer.cells.length} bytes, expected ${expected} (${size.width}×${size.height} × ${HALF_CELLS_PER_CELL} half-cells)`,
    );
  }
  const g = layer.cells;
  const hw = size.width * 2; // half-cell grid width (row-major 2W × 2H)
  const typeIds = new Array<number>(cells);
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const top = 2 * y * hw + 2 * x;
      const bottom = (2 * y + 1) * hw + 2 * x;
      const raw = reduceHalfCellsToCell(
        g[top] as number,
        g[top + 1] as number,
        g[bottom] as number,
        g[bottom + 1] as number,
      );
      typeIds[y * size.width + x] = raw === LMLT_EMPTY ? VOID_TYPE_ID : raw;
    }
  }
  return { width: size.width, height: size.height, typeIds };
}

// ---------------------------------------------------------------------------
// Name-dictionary chunks (`eapd` patterns, `eald` landscape objects, `eatd` texture groups)
// ---------------------------------------------------------------------------

/**
 * Decodes a name-dictionary chunk (`eapd`/`eald`/`eatd`) into its string list. The payload is a
 * `[u32 count]` header then `count` entries of `[u8 length][length bytes][0x00]` (Latin-1, the same
 * length-prefixed grammar as the `.cif` string pool). These dictionaries are how a map references
 * shared tables version-robustly **by name**: `eapd` mirrors the `pattern.cif` `[GfxPattern]` list
 * (927 names, positional), `eald` the `landscapes.cif` `[GfxLandscape]` list (866 names) — the
 * `empa`/`empb`/`emla` lanes index these lists, and the names join back onto the extracted IR.
 *
 * Throws on a count that overruns the payload (corrupt/truncated chunk).
 */
export function decodeStringListChunk(chunk: MapDatChunk): string[] {
  const p = chunk.payload;
  if (p.length < 4) {
    throw new Error(`mapdat: chunk "${chunk.tag}" is too short for a string-list header`);
  }
  const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const count = view.getUint32(0, true);
  const out: string[] = [];
  let off = 4;
  for (let i = 0; i < count; i++) {
    if (off >= p.length) {
      throw new Error(`mapdat: chunk "${chunk.tag}" string list truncated at entry ${i}/${count}`);
    }
    const len = p[off] as number;
    off += 1;
    if (off + len + 1 > p.length) {
      throw new Error(`mapdat: chunk "${chunk.tag}" string entry ${i} overruns the payload`);
    }
    if (p[off + len] !== 0) {
      // A misidentified chunk decodes to garbage names silently unless the terminator is verified.
      throw new Error(`mapdat: chunk "${chunk.tag}" string entry ${i} is not 0x00-terminated`);
    }
    let s = '';
    for (let k = 0; k < len; k++) s += String.fromCharCode(p[off + k] as number);
    out.push(s);
    off += len + 1; // skip the (verified) trailing 0x00
  }
  return out;
}
