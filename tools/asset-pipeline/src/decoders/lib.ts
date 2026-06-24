/**
 * `.lib` archive decoder — Cultures "SimpleFileLibrary" packed container.
 *
 * Ported FORMAT (not architecture) from OpenVikings `Source/NXBasics/`:
 *   - CSimpleFileLibrary.cs  header layout, ASCII length-prefixed names, filename checksum
 *   - Dexter/DexterEndian.cs `FileReadLongLSB` (u32 is little-endian)
 * Referenced at OpenVikings_reversing @ working tree 2026-06.
 *
 * Layout (all u32 little-endian):
 *   u32 version            // the original reads and ignores it; observed value 1
 *   u32 groupCount
 *   u32 fileCount
 *   groupCount × { u32 nameLen; nameLen ASCII bytes; u32 value }
 *   fileCount  × { u32 nameLen; nameLen ASCII bytes; u32 position; u32 size }
 *   ... file payloads: each is `size` bytes at absolute `position` from the start of the archive.
 *
 * Names are backslash paths (e.g. `data\logic\goodtypes.cif`). The on-disk record does NOT store
 * a checksum — the original recomputes it from the (lowercased) name and uses it as the lookup key
 * (`GetEntryId`: filter by checksum, then case-insensitive name compare).
 *
 * Pure functions only (no I/O): `(bytes) => decoded`. The CLI wires file reads around them.
 */

/** One directory group: a path-prefix label plus its opaque value (group id). */
export interface LibGroup {
  readonly name: string;
  readonly value: number;
}

/** One archived file: its directory entry plus a zero-copy view of its payload. */
export interface LibFile {
  readonly name: string;
  /** Lookup key the original computes from the name: sum of lowercased ASCII bytes, mod 256. */
  readonly checksum: number;
  /** Absolute byte offset of the payload from the start of the archive. */
  readonly position: number;
  readonly size: number;
  /** View into the source buffer over `[position, position + size)` — not a copy. */
  readonly data: Uint8Array;
}

/** A decoded `.lib` archive: its directory and per-file payload views. */
export interface LibArchive {
  /** Leading u32; the original reads and ignores it (observed value 1). Preserved for round-trips. */
  readonly version: number;
  readonly groups: readonly LibGroup[];
  readonly files: readonly LibFile[];
}

/** Latin1 maps all 256 byte values 1:1; archive names are ASCII so this is exact. */
const LATIN1 = new TextDecoder('latin1');

/**
 * Filename → lookup checksum (CSimpleFileLibrary `CalculateFilenameChecksum`): the sum of the
 * lowercased ASCII byte values, taken mod 256, folding only A-Z. Real archive names are ASCII
 * backslash paths, for which this is exact; for hypothetical non-ASCII names it can diverge from
 * the original (which folds the char before truncating to a byte), but those don't occur.
 */
export function filenameChecksum(name: string): number {
  let sum = 0;
  for (let i = 0; i < name.length; i++) {
    let c = name.charCodeAt(i) & 0xff;
    if (c >= 0x41 && c <= 0x5a) c += 0x20; // A-Z -> a-z
    sum = (sum + c) & 0xff;
  }
  return sum;
}

/** Little-endian sequential reader over a byte buffer. Throws on overrun (corrupt archive = bug). */
class LibReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private pos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u32(): number {
    if (this.pos + 4 > this.bytes.length) {
      throw new Error(`lib: read of 4 bytes overruns buffer at offset ${this.pos}`);
    }
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** Reads `n` raw bytes as a latin1 string (names are ASCII; latin1 is a faithful 1:1 mapping). */
  ascii(n: number): string {
    if (this.pos + n > this.bytes.length) {
      throw new Error(`lib: read of ${n} bytes overruns buffer at offset ${this.pos}`);
    }
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return LATIN1.decode(slice);
  }
}

/**
 * Decodes a `.lib` archive directory and returns per-file payload views. Throws on a structurally
 * invalid container (truncated directory, or a payload range outside the buffer) — a batch pipeline
 * over many owned files should wrap each call per-file so one corrupt `.lib` can't abort the run.
 *
 * Each payload's `[position, position + size)` is checked to fit the buffer, but positions are
 * otherwise trusted as the original engine trusts them: they are not cross-validated for overlap or
 * for pointing back into the directory, so a malformed archive can yield in-bounds-but-wrong views.
 */
export function decodeLib(bytes: Uint8Array): LibArchive {
  const r = new LibReader(bytes);
  const version = r.u32();
  const groupCount = r.u32();
  const fileCount = r.u32();

  const groups: LibGroup[] = [];
  for (let i = 0; i < groupCount; i++) {
    const name = r.ascii(r.u32());
    const value = r.u32();
    groups.push({ name, value });
  }

  const files: LibFile[] = [];
  for (let i = 0; i < fileCount; i++) {
    const name = r.ascii(r.u32());
    const position = r.u32();
    const size = r.u32();
    if (position + size > bytes.length) {
      throw new Error(
        `lib: file "${name}" payload [${position}, ${position + size}) overruns archive of ${bytes.length} bytes`,
      );
    }
    files.push({
      name,
      checksum: filenameChecksum(name),
      position,
      size,
      data: bytes.subarray(position, position + size),
    });
  }

  return { version, groups, files };
}

/**
 * Case-insensitive lookup by name, mirroring the original (`GetEntryId`: filter by filename
 * checksum, then compare names ignoring ASCII case). `name` must use the archive's backslash paths.
 */
export function findLibFile(archive: LibArchive, name: string): LibFile | undefined {
  const checksum = filenameChecksum(name);
  const lower = name.toLowerCase();
  return archive.files.find((f) => f.checksum === checksum && f.name.toLowerCase() === lower);
}

/** A file to pack into an archive: just a name and its raw bytes (position/checksum are derived). */
export interface LibFileInput {
  readonly name: string;
  readonly data: Uint8Array;
}

/** What {@link encodeLib} serializes: the directory inputs and the payloads to lay out. */
export interface LibArchiveInput {
  /** Leading u32 (default 1). */
  readonly version?: number;
  readonly groups?: readonly LibGroup[];
  readonly files: readonly LibFileInput[];
}

/** Encodes a name as latin1 bytes (1:1 byte mapping; ASCII filenames stay exact). */
function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/**
 * Inverse of {@link decodeLib}: serializes a `.lib` with payloads laid out sequentially right after
 * the directory. Kept faithful so decode can be round-trip tested without committing copyrighted
 * fixtures (the same rationale as the `.cif` cipher pair). Positions are absolute, matching the
 * format — a real archive may order payloads differently, but decode reads them by position either way.
 */
export function encodeLib(input: LibArchiveInput): Uint8Array {
  const version = input.version ?? 1;
  const groups = input.groups ?? [];
  const files = input.files;

  const groupNames = groups.map((g) => asciiBytes(g.name));
  const fileNames = files.map((f) => asciiBytes(f.name));

  let dirSize = 12; // version + groupCount + fileCount
  for (const n of groupNames) dirSize += 4 + n.length + 4;
  for (const n of fileNames) dirSize += 4 + n.length + 4 + 4;

  let payloadSize = 0;
  for (const f of files) payloadSize += f.data.length;

  const out = new Uint8Array(dirSize + payloadSize);
  const view = new DataView(out.buffer);
  let p = 0;
  const w32 = (v: number): void => {
    view.setUint32(p, v >>> 0, true);
    p += 4;
  };
  const wBytes = (b: Uint8Array): void => {
    out.set(b, p);
    p += b.length;
  };

  w32(version);
  w32(groups.length);
  w32(files.length);
  for (let i = 0; i < groups.length; i++) {
    const n = groupNames[i] as Uint8Array;
    w32(n.length);
    wBytes(n);
    w32((groups[i] as LibGroup).value);
  }
  let payloadPos = dirSize;
  for (let i = 0; i < files.length; i++) {
    const n = fileNames[i] as Uint8Array;
    const data = (files[i] as LibFileInput).data;
    w32(n.length);
    wBytes(n);
    w32(payloadPos);
    w32(data.length);
    payloadPos += data.length;
  }
  for (const f of files) wBytes(f.data);

  return out;
}
