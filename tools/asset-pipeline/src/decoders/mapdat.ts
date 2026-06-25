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
 * (`[u32 width][u32 height]`, the grid dims that cross-check the `map.cif` `mapsize`). The per-cell
 * grid layers (`lmhe`,`lmlt`,`lmlv`,…) are `pck`/`X8el`-packed bitmaps whose inner header is not yet
 * decoded — a future packed-layer unpack is the next leg; this reader exposes their raw payload
 * views (via `findChunk`) so that work can build on a parsed container.
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
