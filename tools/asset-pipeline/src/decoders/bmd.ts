/**
 * `.bmd` "bob" container decoder — CBobManager (storable id 0x3F4).
 *
 * A `.bmd` holds a framed sprite set ("bobs"): GUI windows, settler animation frames, terrain bobs.
 * On disk it is one serialized `CStorable`:
 *
 *   [u32 id=0x3F4][u32 version]                  storable header
 *   [u32 firstBobId]                             id of bob[0]; bob N lives at index (id - firstBobId)
 *   [u32 bobCount]
 *   [u32 packedLineDataUsedBytes]
 *   [u32 lineControlCount]
 *   [u32 generatedNonEmptyLines]                 generator bookkeeping (carried, not interpreted)
 *   [u32 generatedEmptyLines]
 *   [u32 generatedPackedLines]
 *   if bobCount != 0, three CMemory storables follow (each [u32 id=0x3E9][u32 ver][u32 size][bytes]):
 *     (1) bob-data array   = bobCount × 24-byte records {i32 type, i32 x,y,w,h, u32 misc}
 *     (2) packed-line data = the RLE-ish byte stream the per-scanline pixels decode from
 *     (3) line-control     = lineControlCount × u32, indexed by absolute Y; each packs
 *                            [xMin (top 10 bits)][offset into packed-line data (low 22 bits)]
 *
 * This decoder solves the **container** layer only: it splits a `.bmd` into the header fields, the
 * typed bob records, and the two raw blocks (packed-line bytes + line-control words). Turning the
 * packed-line stream into actual frame pixels (the RLE codec + palette/remap application) and
 * stitching frames into an atlas is the next, larger step — the same way `.cif` landed as a
 * container parse before the IR extractors.
 *
 * Ported FORMAT (not architecture) from OpenVikings `Source/NXBasics/`:
 *   - CStorable.cs    on-disk object header: [u32 id][u32 version][body]; `Storable_Save` writes id+ver
 *   - XBStorable.cs   factory: id 0x3F4 -> `new CBobManager(file)`
 *   - CBobManager.cs  `CBobManager(CFile)` ctor (0x1C-byte header + 3 CMemory blocks),
 *                     `ReadBobDataFromMemory` (24-byte record layout), `Storable_SaveData` (inverse),
 *                     `SBobData` struct {int Type; SRectangle Area; uint Misc}, `IsBobHit` (line-control
 *                     packing: offset = ctrl & 0x3FFFFF, xMin = ctrl >> 22)
 *   - CMemory.cs      body: [u32 size][size bytes] (raw; NOT encrypted in the bob graph)
 * Referenced at OpenVikings_reversing @ working tree 2026-06.
 *
 * Pure functions only (no I/O): `(bytes) => decoded`. The CLI wires file reads around them.
 * `encodeBmd` is the faithful inverse, used to round-trip test without committing copyrighted fixtures
 * (same rationale as the `.lib`/`.cif`/`.pcx`/`.palette` encoder pairs).
 */

import { StorableId } from './cif.js';

const STORABLE_HEADER_BYTES = 8; // [u32 id][u32 version]
const BMD_ID = StorableId.CBobManager; // 0x3F4
const MEMORY_ID = StorableId.CMemory; // 0x3E9
const BOB_RECORD_BYTES = 24; // i32 type + 4×i32 rect + u32 misc

/** Line-control packing (CBobManager `IsBobHit`): a u32 = [xMin: 10 bits][packed offset: 22 bits]. */
export const PACKED_OFFSET_MASK = 0x003fffff; // low 22 bits = byte offset into packed-line data
export const PACKED_X_SHIFT = 22; // high 10 bits = xMin (first non-transparent column)

/** An empty/absent bob slot — no pixels (CBobManager `PrintBob` returns early on `Type == 0`). */
export const BOB_TYPE_EMPTY = 0;
/** 8-bit bob: each raw-run byte is a palette index (CBobManager `TBobType.Bob8Bit`). */
export const BOB_TYPE_8BIT = 1;
/** 1-bit mask bob: each raw-run byte is 0/1; set pixels draw as index 0xFF (`TBobType.Bob1Bit`). */
export const BOB_TYPE_1BIT = 2;
/** TimeMask bob: same packed layout as 8-bit; print modes reinterpret it (`TBobType.TimeMask`). */
export const BOB_TYPE_TIMEMASK = 3;
/** Double-byte bob: each raw-run pixel is two bytes [index][skip] (`TBobType.Double8Bit`). */
export const BOB_TYPE_DOUBLE8BIT = 4;

/** Index written for a set pixel of a 1-bit mask bob (CBobManager draws masks as palette entry 0xFF). */
export const BOB_MASK_INDEX = 0xff;

/** An axis-aligned bob rectangle (origin + size), all signed ints (offsets can be negative). */
export interface BobArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One bob record from the bob-data array (24 bytes on disk). */
export interface BobRecord {
  /** Bob kind (0 = empty/absent slot; nonzero = 1-bit / 8-bit / double-byte variants). Carried raw. */
  readonly type: number;
  /**
   * The bob's draw rectangle: `width`×`height` is the frame size; `x`/`y` are the DRAW OFFSET (where to
   * blit the frame relative to the entity's anchor/feet — often negative). These are render-time offsets
   * ONLY; they are NOT indices into the packed-line / line-control data (that base is {@link misc}).
   */
  readonly area: BobArea;
  /**
   * The bob's FIRST-LINE index into the global line-control array (record+0x14): its `height` scanlines
   * are `lineControl[misc .. misc+height)`. The line-control array is the per-bob scanlines stacked
   * contiguously (its length equals the sum of every bob's height), so this is each bob's base offset
   * into that stack — the load-bearing field {@link decodeBobFrame} walks, not `area.y`.
   */
  readonly misc: number;
}

/** A decoded `.bmd` (CBobManager) container: header fields + typed records + the two raw blocks. */
export interface Bmd {
  /** Storable version word from the header (carried, not interpreted). */
  readonly version: number;
  /** Id of `bobs[0]`; bob with id `n` is `bobs[n - firstBobId]`. */
  readonly firstBobId: number;
  /** Number of bob records (and the length of {@link bobs}). */
  readonly bobCount: number;
  /** Generator bookkeeping counters (record+0x18..0x20), carried for faithful round-trips. */
  readonly generatedNonEmptyLines: number;
  readonly generatedEmptyLines: number;
  readonly generatedPackedLines: number;
  /** The bob records, in index order. Empty when `bobCount === 0`. */
  readonly bobs: readonly BobRecord[];
  /** Raw packed-line byte stream (logical length = the header's `packedLineDataUsedBytes`). */
  readonly packedLineData: Uint8Array;
  /** Line-control words, indexed by absolute Y; see {@link PACKED_OFFSET_MASK} / {@link PACKED_X_SHIFT}. */
  readonly lineControl: Uint32Array;
}

/** Little-endian sequential reader. Throws on overrun (a corrupt container is a boundary failure). */
class ByteReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private pos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u32(): number {
    if (this.pos + 4 > this.bytes.length) {
      throw new Error(`bmd: read of 4 bytes overruns buffer at offset ${this.pos}`);
    }
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    if (this.pos + 4 > this.bytes.length) {
      throw new Error(`bmd: read of 4 bytes overruns buffer at offset ${this.pos}`);
    }
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  take(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) {
      throw new Error(`bmd: read of ${n} bytes overruns buffer at offset ${this.pos}`);
    }
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }
}

/** Reads one CMemory storable body (`[u32 id=0x3E9][u32 ver][u32 size][size bytes]`), returning a copy. */
function readCMemory(r: ByteReader): Uint8Array {
  const id = r.u32();
  r.u32(); // version (unused)
  if (id !== MEMORY_ID) {
    throw new Error(`bmd: expected CMemory (0x3E9), got storable id 0x${id.toString(16)}`);
  }
  const size = r.u32();
  // Copy out so the result owns its bytes independent of the source buffer.
  return Uint8Array.from(r.take(size));
}

/**
 * Decodes a `.bmd` (CBobManager) container into its header, typed bob records, and the two raw blocks.
 * Throws a `bmd:`-prefixed error on a wrong root id or a structurally short/inconsistent buffer (a
 * batch pipeline should wrap the call per-file so one bad bob set can't abort the run).
 */
export function decodeBmd(bytes: Uint8Array): Bmd {
  const r = new ByteReader(bytes);

  const id = r.u32();
  const version = r.u32();
  if (id !== BMD_ID) {
    throw new Error(`bmd: root is not a CBobManager (0x3F4); got 0x${id.toString(16)}`);
  }

  const firstBobId = r.u32();
  const bobCount = r.u32();
  const packedLineDataUsedBytes = r.u32();
  const lineControlCount = r.u32();
  const generatedNonEmptyLines = r.u32();
  const generatedEmptyLines = r.u32();
  const generatedPackedLines = r.u32();

  if (bobCount === 0) {
    return {
      version,
      firstBobId,
      bobCount,
      generatedNonEmptyLines,
      generatedEmptyLines,
      generatedPackedLines,
      bobs: [],
      packedLineData: new Uint8Array(0),
      lineControl: new Uint32Array(0),
    };
  }

  // (1) bob-data CMemory: bobCount × 24-byte records.
  const bobMem = readCMemory(r);
  const needed = bobCount * BOB_RECORD_BYTES;
  if (bobMem.length < needed) {
    throw new Error(`bmd: bob-data block is ${bobMem.length} bytes, need ${needed} for ${bobCount} records`);
  }
  const bobView = new DataView(bobMem.buffer, bobMem.byteOffset, bobMem.byteLength);
  const bobs: BobRecord[] = [];
  for (let i = 0; i < bobCount; i++) {
    const base = i * BOB_RECORD_BYTES;
    bobs.push({
      type: bobView.getInt32(base + 0, true),
      area: {
        x: bobView.getInt32(base + 4, true),
        y: bobView.getInt32(base + 8, true),
        width: bobView.getInt32(base + 12, true),
        height: bobView.getInt32(base + 16, true),
      },
      misc: bobView.getUint32(base + 20, true),
    });
  }

  // (2) packed-line CMemory: a raw byte stream. The header's used-bytes is the logical length; the
  // CMemory may be allocated larger, so clamp to the smaller of the two (mirrors the oracle's reads).
  const packedMemRaw = readCMemory(r);
  const packedLen = Math.min(packedMemRaw.length, packedLineDataUsedBytes);
  const packedLineData = packedMemRaw.subarray(0, packedLen);

  // (3) line-control CMemory: lineControlCount × u32 (little-endian).
  const lineMem = readCMemory(r);
  const lineNeeded = lineControlCount * 4;
  if (lineMem.length < lineNeeded) {
    throw new Error(
      `bmd: line-control block is ${lineMem.length} bytes, need ${lineNeeded} for ${lineControlCount} entries`,
    );
  }
  const lineView = new DataView(lineMem.buffer, lineMem.byteOffset, lineMem.byteLength);
  const lineControl = new Uint32Array(lineControlCount);
  for (let i = 0; i < lineControlCount; i++) {
    lineControl[i] = lineView.getUint32(i * 4, true);
  }

  return {
    version,
    firstBobId,
    bobCount,
    generatedNonEmptyLines,
    generatedEmptyLines,
    generatedPackedLines,
    bobs,
    packedLineData: Uint8Array.from(packedLineData),
    lineControl,
  };
}

/** Little-endian sequential writer that grows its backing buffer as needed. */
class ByteWriter {
  private buf = new Uint8Array(256);
  private pos = 0;

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const grown = new Uint8Array(cap);
    grown.set(this.buf);
    this.buf = grown;
  }

  u32(v: number): void {
    this.ensure(4);
    new DataView(this.buf.buffer).setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }

  i32(v: number): void {
    this.ensure(4);
    new DataView(this.buf.buffer).setInt32(this.pos, v | 0, true);
    this.pos += 4;
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  result(): Uint8Array {
    return this.buf.subarray(0, this.pos);
  }
}

/** Writes one CMemory storable: `[u32 id=0x3E9][u32 ver=0][u32 size][size bytes]`. */
function writeCMemory(w: ByteWriter, body: Uint8Array): void {
  w.u32(MEMORY_ID);
  w.u32(0); // CMemory's default storable version
  w.u32(body.length);
  w.bytes(body);
}

/**
 * Inverse of {@link decodeBmd}: serializes a `.bmd` (CBobManager) container. Faithful to the original's
 * `Storable_SaveData`, so a decode can be round-tripped without committing copyrighted assets. When
 * `bobCount === 0` no CMemory blocks are written, matching the original. The packed-line CMemory's
 * `used-bytes` header equals the packed-line array's length (a freshly-saved file has no slack).
 */
export function encodeBmd(bmd: Bmd): Uint8Array {
  const w = new ByteWriter();

  w.u32(BMD_ID);
  w.u32(bmd.version);
  w.u32(bmd.firstBobId);
  w.u32(bmd.bobCount);
  w.u32(bmd.packedLineData.length); // packedLineDataUsedBytes
  w.u32(bmd.lineControl.length); // lineControlCount
  w.u32(bmd.generatedNonEmptyLines);
  w.u32(bmd.generatedEmptyLines);
  w.u32(bmd.generatedPackedLines);

  if (bmd.bobCount === 0) {
    return Uint8Array.from(w.result());
  }

  if (bmd.bobs.length !== bmd.bobCount) {
    throw new Error(`bmd: bobs.length ${bmd.bobs.length} does not match bobCount ${bmd.bobCount}`);
  }

  // (1) bob-data block.
  const bobMem = new Uint8Array(bmd.bobCount * BOB_RECORD_BYTES);
  const bobView = new DataView(bobMem.buffer);
  for (let i = 0; i < bmd.bobCount; i++) {
    const base = i * BOB_RECORD_BYTES;
    const bob = bmd.bobs[i] as BobRecord;
    bobView.setInt32(base + 0, bob.type | 0, true);
    bobView.setInt32(base + 4, bob.area.x | 0, true);
    bobView.setInt32(base + 8, bob.area.y | 0, true);
    bobView.setInt32(base + 12, bob.area.width | 0, true);
    bobView.setInt32(base + 16, bob.area.height | 0, true);
    bobView.setUint32(base + 20, bob.misc >>> 0, true);
  }
  writeCMemory(w, bobMem);

  // (2) packed-line block (raw bytes).
  writeCMemory(w, bmd.packedLineData);

  // (3) line-control block (u32 array -> little-endian bytes).
  const lineMem = new Uint8Array(bmd.lineControl.length * 4);
  const lineView = new DataView(lineMem.buffer);
  for (let i = 0; i < bmd.lineControl.length; i++) {
    lineView.setUint32(i * 4, bmd.lineControl[i] as number, true);
  }
  writeCMemory(w, lineMem);

  return Uint8Array.from(w.result());
}

/** Sentinel line-control word meaning "this scanline is fully transparent" (CBobManager `0xFFFFFFFF`). */
const LINE_CONTROL_EMPTY = 0xffffffff;

/**
 * One decoded bob frame: indexed pixels plus a parallel opacity mask. Index 0 is a real palette colour
 * here (transparency is per-pixel via the codec's skip runs, not a reserved index), so a renderer needs
 * {@link mask} to know which pixels were actually written; unwritten pixels keep `index 0`, `mask 0`.
 * Convert to RGBA by sampling a palette at each `mask=1` pixel (the bob's palette lives outside the `.bmd`).
 */
export interface BobFrame {
  /** Frame width in pixels (the bob's `area.width`). */
  readonly width: number;
  /** Frame height in pixels (the bob's `area.height`). */
  readonly height: number;
  /** Row-major (top→bottom) palette indices, length `width * height`. Unwritten pixels are 0. */
  readonly pixels: Uint8Array;
  /** Row-major opacity: 1 where the codec wrote a pixel, 0 where it skipped (transparent). */
  readonly mask: Uint8Array;
}

/**
 * Decodes one bob's packed-line RLE into an indexed-pixel frame + opacity mask. Pure: it reads only the
 * already-parsed {@link Bmd} blocks, so palette/atlas concerns stay out of the codec (mirrors how `.pcx`
 * yields indexed pixels and `expandToRgba` is a separate step).
 *
 * Format (ported from CBobManager `PrintBob_*Core` + the `PrintPackedLine_*` walkers): the bob's `area`
 * gives the frame size; its scanlines are `lineControl[bob.misc + line]` (`misc` is the bob's first-line
 * index into the contiguously-stacked line-control array — NOT `area.y`, which is the draw offset). For
 * each of `height` scanlines that word is either {@link LINE_CONTROL_EMPTY} (fully transparent row) or
 * `[xMin (10b)][offset (22b)]`. From `packedLineData[offset]` we walk control bytes until a `0`
 * terminator: a byte with the high bit clear is a **raw run** of `count = b & 0x7F` pixels whose data
 * follows inline; high bit set is a **skip run** (transparent) of `count` pixels. Either way the cursor
 * advances `count` columns. Columns are in the bob's LOCAL frame space (starting at `xMin`); `area.x` is
 * the draw offset and is NOT applied here.
 *
 * Per-type pixel width within a raw run: 8-bit/TimeMask store one index byte each; Double8Bit stores two
 * bytes each (index then a skipped byte); 1-bit masks store one 0/1 byte each, drawn as {@link BOB_MASK_INDEX}.
 * An empty bob (`type 0`) or non-positive size yields a frame sized to the (clamped) area with an all-transparent mask.
 *
 * Throws a `bmd:`-prefixed error on an out-of-range `bobIndex` (a programmer error). A structurally
 * corrupt packed-line stream is tolerated, not thrown: the walker stops at the buffer end and at any
 * column outside the frame, exactly like the original's clipped `Draw_SetPixel` (a recoverable boundary).
 */
export function decodeBobFrame(bmd: Bmd, bobIndex: number): BobFrame {
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

  // Per raw-run pixel: how many packed bytes it consumes, and the index it yields from those bytes.
  const isDouble = bob.type === BOB_TYPE_DOUBLE8BIT;
  const isMask = bob.type === BOB_TYPE_1BIT;
  const bytesPerPixel = isDouble ? 2 : 1;
  const packed = bmd.packedLineData;

  for (let line = 0; line < height; line++) {
    // The bob's scanlines occupy a CONTIGUOUS block of the global line-control array starting at
    // `bob.misc` — its first-line index, NOT `area.y` (area.x/area.y are the DRAW offset, often
    // negative, applied only when blitting; see the `misc`/`area` field docs). Using `area.y` here was
    // the bug that decoded only the bottom few rows of each bob (a tiny fragment).
    const ctrlIndex = bob.misc + line;
    if (ctrlIndex < 0 || ctrlIndex >= bmd.lineControl.length) continue;
    const ctrl = bmd.lineControl[ctrlIndex] as number;
    if (ctrl === LINE_CONTROL_EMPTY) continue;

    const xMin = ctrl >>> PACKED_X_SHIFT;
    let pos = ctrl & PACKED_OFFSET_MASK;
    if (pos >= packed.length) continue;

    // Column cursor in the bob's LOCAL frame space (0..width). `xMin` is the first non-transparent
    // local column; runs advance from there. area.x is the draw offset, NOT subtracted here (doing so
    // shifted content right and clipped hundreds of pixels off the right edge).
    let absX = xMin;
    const rowBase = line * width;

    let b = packed[pos] as number;
    while (b !== 0) {
      pos++;
      const count = b & 0x7f;
      const isRaw = (b & 0x80) === 0;

      if (isRaw) {
        for (let i = 0; i < count; i++) {
          if (pos + bytesPerPixel > packed.length) {
            return { width, height, pixels, mask }; // truncated stream: stop, like the clipped original
          }
          const value = packed[pos] as number;
          pos += bytesPerPixel; // double-byte consumes the trailing skip byte too
          const col = absX + i;
          if (col >= 0 && col < width) {
            if (isMask) {
              if (value !== 0) {
                pixels[rowBase + col] = BOB_MASK_INDEX;
                mask[rowBase + col] = 1;
              }
            } else {
              pixels[rowBase + col] = value;
              mask[rowBase + col] = 1;
            }
          }
        }
      }
      // Skip runs (and the not-drawn pixels of a mask raw run) leave mask=0 — already transparent.

      absX += count;
      if (pos >= packed.length) break;
      b = packed[pos] as number;
    }
  }

  return { width, height, pixels, mask };
}
