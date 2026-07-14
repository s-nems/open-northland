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
 * This module solves the container layer only: it splits a `.bmd` into the header fields, the typed bob
 * records, and the two raw blocks (packed-line bytes + line-control words). Turning the packed-line
 * stream into actual frame pixels (the RLE codec) lives beside it in {@link ./frame} — the same way `.pcx`
 * keeps `decodePcx` (container) separate from `expandToRgba` (pixels).
 *
 * Ported format (not architecture) from OpenVikings `Source/NXBasics/`:
 *   - CStorable.cs    on-disk object header: [u32 id][u32 version][body]; `Storable_Save` writes id+ver
 *   - XBStorable.cs   factory: id 0x3F4 -> `new CBobManager(file)`
 *   - CBobManager.cs  `CBobManager(CFile)` ctor (0x1C-byte header + 3 CMemory blocks),
 *                     `ReadBobDataFromMemory` (24-byte record layout), `Storable_SaveData` (inverse),
 *                     `SBobData` struct {int Type; SRectangle Area; uint Misc}, `IsBobHit` (line-control
 *                     packing: offset = ctrl & 0x3FFFFF, xMin = ctrl >> 22)
 *   - CMemory.cs      body: [u32 size][size bytes] (raw; not encrypted in the bob graph)
 * Referenced at OpenVikings_reversing @ working tree 2026-06.
 *
 * Pure functions only (no I/O): `(bytes) => decoded`. The CLI wires file reads around them.
 * `encodeBmd` is the faithful inverse, used to round-trip test without committing copyrighted fixtures
 * (same rationale as the `.lib`/`.cif`/`.pcx`/`.palette` encoder pairs).
 */

import { ByteCursor, ByteWriter } from '../byte-cursor.js';
import { readCMemory, StorableId } from '../cif.js';

const BMD_ID = StorableId.CBobManager; // 0x3F4
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
/**
 * TimeMask bob: each raw-run pixel is two bytes `[value, timeByte]` (`TBobType.TimeMask`). The time byte
 * is a 0–255 visibility threshold — CBobManager `PrintPackedLine_TimeMaskAsImage` /
 * `PrintBob_UsingTimeMask` draw a pixel only when the print-time `time` argument is `>= timeByte`, the
 * engine's progressive-reveal (building construction) blit.
 */
export const BOB_TYPE_TIMEMASK = 3;
/**
 * Double-byte bob: each raw-run pixel is two bytes `[index, second]` (`TBobType.Double8Bit`). What the
 * second byte means depends on which print path the consumer routes through — the oracle has no call
 * sites, so it is inferred per consumer class from the byte distributions and the original's look:
 * alpha (`PrintBob_UsingShadedAlpha`, `a ≤ 0` skipped) for the soft decals (ferns median 172, smoke
 * 77, waves ~35), or a 0–255 construction-progress threshold for the `[GfxHouse]` bobs (measured:
 * spans ~0–255, row-correlated bottom-up, mean ≈100 over solid walls — not coverage), drawn via
 * `PrintBob_UsingTimeMask` under construction and the plain byte-skipping blit when finished.
 * `decodeBobFrame`'s `secondByte` option picks the interpretation (`AtlasAlphaMode` routes it).
 */
export const BOB_TYPE_DOUBLE8BIT = 4;

/** Coverage of a written pixel of a non-alpha bob type (8-bit / 1-bit mask / TimeMask): fully opaque. */
export const BOB_ALPHA_OPAQUE = 0xff;

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
   * The bob's draw rectangle: `width`×`height` is the frame size; `x`/`y` are the draw offset (where to
   * blit the frame relative to the entity's anchor/feet — often negative). These are render-time offsets
   * only, not indices into the packed-line / line-control data (that base is {@link misc}).
   */
  readonly area: BobArea;
  /**
   * The bob's first-line index into the global line-control array (record+0x14): its `height` scanlines
   * are `lineControl[misc .. misc+height)`. The line-control array is the per-bob scanlines stacked
   * contiguously (its length equals the sum of every bob's height), so this is each bob's base offset
   * into that stack — the field {@link import('./frame.js').decodeBobFrame} walks, not `area.y`.
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

/**
 * Decodes a `.bmd` (CBobManager) container into its header, typed bob records, and the two raw blocks.
 * Throws a `bmd:`-prefixed error on a wrong root id or a structurally short/inconsistent buffer (a
 * batch pipeline should wrap the call per-file so one bad bob set can't abort the run).
 */
export function decodeBmd(bytes: Uint8Array): Bmd {
  const r = new ByteCursor(bytes, 'bmd');

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

/** Writes one CMemory storable: `[u32 id=0x3E9][u32 ver=0][u32 size][size bytes]`. */
function writeCMemory(w: ByteWriter, body: Uint8Array): void {
  w.u32(StorableId.CMemory);
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
    return w.result();
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

  return w.result();
}
