import type { FileHandle } from 'node:fs/promises';
import { inflateRaw } from 'node:zlib';

/**
 * Minimal ZIP reader for the mod-download flow (PKWARE APPNOTE 4.5 layout: end-of-central-directory
 * record → central directory → per-entry local headers). Supports the two compression methods real
 * archives use (0 = stored, 8 = deflate); ZIP64 archives are rejected — the CnMod zip is ~600 MB
 * with ~46k entries, well inside the classic limits. Kept dependency-free like the pipeline's other
 * binary decoders.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** EOCD fixed part is 22 bytes; the trailing archive comment can be up to 64 KiB. */
const EOCD_MIN_SIZE = 22;
const EOCD_SEARCH_SPAN = EOCD_MIN_SIZE + 0xffff;
/** General-purpose flag bit 11: the entry name is UTF-8 (otherwise CP437; decoded as latin1 —
 * byte-preserving and unambiguous for path handling). */
const UTF8_NAME_FLAG = 1 << 11;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export interface ZipEntry {
  /** Entry name as stored (forward-slash separated); directories end with `/`. */
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  /** Offset of the entry's local file header from the start of the archive. */
  readonly localHeaderOffset: number;
}

async function readAt(fh: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buffer, 0, length, offset);
  if (bytesRead !== length) throw new Error(`zip: short read at ${offset} (${bytesRead}/${length})`);
  return buffer;
}

/** Reads the central directory of the archive behind `fh` (of `fileSize` bytes). */
export async function readZipEntries(fh: FileHandle, fileSize: number): Promise<ZipEntry[]> {
  const span = Math.min(fileSize, EOCD_SEARCH_SPAN);
  const tail = await readAt(fh, fileSize - span, span);
  let eocd = -1;
  for (let i = span - EOCD_MIN_SIZE; i >= 0; i--) {
    // A real EOCD's comment length must reach exactly the end of the file — this rejects a stray
    // signature embedded in the comment (or in trailing garbage) that a plain scan would take.
    if (tail.readUInt32LE(i) === EOCD_SIGNATURE && i + EOCD_MIN_SIZE + tail.readUInt16LE(i + 20) === span) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('zip: no end-of-central-directory record (not a zip file?)');
  const count = tail.readUInt16LE(eocd + 10);
  const cdSize = tail.readUInt32LE(eocd + 12);
  const cdOffset = tail.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip: ZIP64 archives are not supported');
  // Sizes/offsets are attacker-readable u32 fields; anything past the file itself is a lie and
  // would otherwise drive a multi-GB Buffer.alloc before the first read fails.
  if (cdOffset + cdSize > fileSize) throw new Error('zip: central directory lies outside the file');

  const cd = await readAt(fh, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > cd.length || cd.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new Error(`zip: corrupt central directory at entry ${i}`);
    }
    const flags = cd.readUInt16LE(at + 8);
    const method = cd.readUInt16LE(at + 10);
    const compressedSize = cd.readUInt32LE(at + 20);
    const size = cd.readUInt32LE(at + 24);
    const nameLength = cd.readUInt16LE(at + 28);
    const extraLength = cd.readUInt16LE(at + 30);
    const commentLength = cd.readUInt16LE(at + 32);
    const localHeaderOffset = cd.readUInt32LE(at + 42);
    const name = cd
      .subarray(at + 46, at + 46 + nameLength)
      .toString((flags & UTF8_NAME_FLAG) !== 0 ? 'utf8' : 'latin1');
    entries.push({ name, method, compressedSize, size, localHeaderOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Reads and decompresses one entry's bytes (via its local header, whose extra field can differ from
 * the central one). `fileSize` bounds the claimed compressed size, and the central directory's
 * uncompressed size caps the inflate output — a lying deflate member (zip bomb) fails instead of
 * exhausting memory.
 */
export async function readZipEntryData(
  fh: FileHandle,
  entry: ZipEntry,
  fileSize: number,
): Promise<Uint8Array> {
  const local = await readAt(fh, entry.localHeaderOffset, 30);
  if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new Error(`zip: corrupt local header for ${entry.name}`);
  }
  const nameLength = local.readUInt16LE(26);
  const extraLength = local.readUInt16LE(28);
  const dataOffset = entry.localHeaderOffset + 30 + nameLength + extraLength;
  if (dataOffset + entry.compressedSize > fileSize) {
    throw new Error(`zip: entry ${entry.name} lies outside the file`);
  }
  const compressed = await readAt(fh, dataOffset, entry.compressedSize);
  if (entry.method === METHOD_STORED) return compressed;
  if (entry.method === METHOD_DEFLATE) {
    return new Promise((resolvePromise, reject) => {
      inflateRaw(compressed, { maxOutputLength: entry.size }, (err, out) =>
        err ? reject(err) : resolvePromise(out),
      );
    });
  }
  throw new Error(`zip: unsupported compression method ${entry.method} for ${entry.name}`);
}
