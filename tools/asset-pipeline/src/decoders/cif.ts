/**
 * `.cif` container decoder — Cultures Information File.
 *
 * Ported FORMAT (not architecture) from OpenVikings `Source/NXBasics/`:
 *   - XBTools.cs          `XB_Decrypt_Memory` / `XB_Encrypt_Memory` (TEncryptMode.Mode1)
 *   - XBStorable.cs       storable factory: id -> class (0x3E9 CMemory, 0x3FD CStringArray, ...)
 *   - CStorable.cs        on-disk object header: [u32 id][u32 version][body]
 *   - CMemory.cs          body: [u32 size][size bytes] (raw; decrypted separately by the consumer)
 *   - CStringArray.cs     body: 5*u32 header, encrypted offsets CMemory, flag, encrypted pool CMemory
 * Referenced at OpenVikings_reversing @ working tree 2026-06.
 *
 * The genuine Phase-1 unknown was the decrypted record layout. Verified empirically against
 * `Data/logic/housetypes.cif`: the decrypted string pool is depth-prefixed text lines, e.g.
 *   0x01 "logichousetype"            (level 1 = section)
 *   0x02 'debugname "headquarters"'  (level 2 = property)
 * i.e. the same vocabulary as the readable `.ini` sources, just stored as an encrypted CStringArray.
 *
 * Pure functions only (no I/O): `(bytes) => decoded`. The CLI wires file reads around them.
 */

/** Storable class ids from the original factory (XBStorable.cs `LoadObjectOrNull`). */
export const StorableId = {
  CMemory: 0x3e9,
  CBitmap: 0x3f3,
  CBobManager: 0x3f4,
  CFont: 0x3f5,
  CPalette: 0x3f6,
  CRemapTable: 0x3f7,
  CStringArray: 0x3fd,
} as const;

/** One decoded line of a `.cif` string pool: a nesting level + its text. */
export interface CifLine {
  /** Leading control byte (1 = section header, 2 = property, ...); 0 if none. */
  readonly level: number;
  /** The line text after the level byte (structural keywords are ASCII). */
  readonly text: string;
}

/** A decoded `CStringArray` (`.cif` root for type tables and maps). */
export interface CifStringArray {
  readonly forceSequentialIds: boolean;
  readonly stringCount: number;
  readonly usedIdCount: number;
  readonly slotCount: number;
  readonly stringPoolUsedBytes: number;
  /** Strings in canonical id order; empty/hole slots are skipped (so `lines.length` may be < `stringCount`). */
  readonly lines: readonly CifLine[];
}

/**
 * Mode1 stream cipher (XBTools.cs). Symmetric keystream depending only on byte position.
 * Decrypt: `out = (in - 1) ^ key`. Mutates `buf` in place.
 */
export function decryptMode1(buf: Uint8Array): void {
  let b = 0x47;
  let c = 0x7e; // '~'
  const len = buf.length;
  const evenLen = len & ~1;
  let i = 0;
  for (; i < evenLen; i += 2) {
    buf[i] = (((buf[i] as number) - 1) ^ b) & 0xff;
    const key1 = (c + b) & 0xff;
    buf[i + 1] = (((buf[i + 1] as number) - 1) ^ key1) & 0xff;
    b = (c + b + c + 0x21) & 0xff; // b = 2c + b + '!'
    c = (c + 0x42) & 0xff; // c = c + 'B'
  }
  if (len & 1) buf[i] = (((buf[i] as number) - 1) ^ b) & 0xff;
}

/**
 * Inverse of {@link decryptMode1} (XBTools.cs `XB_Encrypt_Memory`): `out = (in ^ key) + 1`.
 * Kept faithful so decode can be round-trip tested without committing copyrighted fixtures.
 * Mutates `buf` in place.
 */
export function encryptMode1(buf: Uint8Array): void {
  let b = 0x47;
  let c = 0x7e; // '~'
  const len = buf.length;
  const evenLen = len & ~1;
  let i = 0;
  for (; i < evenLen; i += 2) {
    buf[i] = (((buf[i] as number) ^ b) + 1) & 0xff;
    const key1 = (c + b) & 0xff;
    buf[i + 1] = (((buf[i + 1] as number) ^ key1) + 1) & 0xff;
    b = (c + b + c + 0x21) & 0xff;
    c = (c + 0x42) & 0xff;
  }
  if (len & 1) buf[i] = (((buf[i] as number) ^ b) + 1) & 0xff;
}

/** Little-endian sequential reader over a byte buffer. Throws on overrun (corrupt container = bug). */
class ByteReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private pos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get offset(): number {
    return this.pos;
  }

  u32(): number {
    if (this.pos + 4 > this.bytes.length) {
      throw new Error(`cif: read of 4 bytes overruns buffer at offset ${this.pos}`);
    }
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  u8(): number {
    if (this.pos >= this.bytes.length) throw new Error('cif: unexpected end of buffer');
    const v = this.bytes[this.pos] as number;
    this.pos += 1;
    return v;
  }

  take(n: number): Uint8Array {
    if (this.pos + n > this.bytes.length) {
      throw new Error(`cif: read of ${n} bytes overruns buffer at offset ${this.pos}`);
    }
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }
}

/** Reads a raw `CMemory` body (still encrypted). Asserts the storable id. */
function readCMemoryRaw(r: ByteReader): Uint8Array {
  const id = r.u32();
  r.u32(); // version (unused)
  if (id !== StorableId.CMemory) {
    throw new Error(`cif: expected CMemory (0x3E9), got storable id 0x${id.toString(16)}`);
  }
  const size = r.u32();
  // Copy out so callers may decrypt without mutating the source buffer.
  return Uint8Array.from(r.take(size));
}

/**
 * Splits a NUL-separated, level-prefixed string pool into {@link CifLine}s by the offsets table.
 * Bounds are the logical `usedBytes` (CStringArray.cs `GetString` clamps to `_stringPoolUsedBytes`,
 * not the raw buffer length, which may carry trailing 0xEE alloc padding).
 */
function readLines(pool: Uint8Array, offsets: Uint8Array, slotCount: number, usedBytes: number): CifLine[] {
  const INVALID = 0xffffffff;
  const limit = Math.min(pool.length, usedBytes);
  const offView = new DataView(offsets.buffer, offsets.byteOffset, offsets.byteLength);
  const decoder = new TextDecoder('latin1'); // structural keywords are ASCII; see CP1250 note below
  const lines: CifLine[] = [];
  for (let id = 0; id < slotCount; id++) {
    const byteIndex = id * 4;
    if (byteIndex + 4 > offsets.length) break;
    const start = offView.getUint32(byteIndex, true);
    if (start === INVALID || start >= limit) continue; // hole
    let end = start;
    while (end < limit && pool[end] !== 0) end++; // an unterminated final entry stops at `limit`
    if (end === start) continue; // empty
    const raw = pool.subarray(start, end);
    const first = raw[0] as number;
    const hasLevel = first < 0x20;
    lines.push({
      level: hasLevel ? first : 0,
      text: decoder.decode(hasLevel ? raw.subarray(1) : raw),
    });
  }
  return lines;
}

/**
 * Decodes a `.cif` whose root is a `CStringArray` (type tables, maps). Returns the decrypted,
 * level-tagged text lines plus the array header. Throws on a structurally invalid container — so a
 * batch pipeline over many owned files must wrap each call per-file (one corrupt `.cif` shouldn't
 * abort the run).
 *
 * NOTE: text is decoded as latin1 to match the OpenVikings oracle byte-for-byte. Display strings
 * carrying Polish glyphs are actually CP1250 — re-decode those at the IR layer where it matters.
 */
export function decodeCifStringArray(bytes: Uint8Array): CifStringArray {
  const r = new ByteReader(bytes);
  const id = r.u32();
  r.u32(); // version
  if (id !== StorableId.CStringArray) {
    throw new Error(`cif: root is not a CStringArray (0x3FD); got 0x${id.toString(16)}`);
  }

  const forceSequentialIds = r.u32() !== 0;
  const stringCount = r.u32();
  const usedIdCount = r.u32();
  const slotCount = r.u32();
  const stringPoolUsedBytes = r.u32();

  const offsets = readCMemoryRaw(r);
  decryptMode1(offsets);

  const hasStringPool = r.u8() !== 0;
  let lines: CifLine[] = [];
  if (hasStringPool) {
    const pool = readCMemoryRaw(r);
    decryptMode1(pool);
    lines = readLines(pool, offsets, slotCount, stringPoolUsedBytes);
  }

  return { forceSequentialIds, stringCount, usedIdCount, slotCount, stringPoolUsedBytes, lines };
}
