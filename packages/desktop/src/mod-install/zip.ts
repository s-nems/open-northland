import type { FileHandle } from 'node:fs/promises';
import { inflateRaw } from 'node:zlib';

/**
 * Minimal ZIP reader (PKWARE APPNOTE 4.5): end-of-central-directory record → central directory →
 * per-entry local headers, with methods 0 (stored) and 8 (deflate). ZIP64 is rejected; the ~600 MB,
 * ~46k-entry CnMod archive stays inside the classic limits.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** EOCD fixed part is 22 bytes; the trailing archive comment can be up to 64 KiB. */
const EOCD_MIN_SIZE = 22;
const EOCD_SEARCH_SPAN = EOCD_MIN_SIZE + 0xffff;
/** Fixed parts of the two per-entry headers; the name/extra/comment fields follow each. */
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;

// Field offsets in bytes from each record's start (APPNOTE sec. 4.3.16 / 4.3.12 / 4.3.7).
const EOCD_ENTRY_COUNT = 10;
const EOCD_CD_SIZE = 12;
const EOCD_CD_OFFSET = 16;
const EOCD_COMMENT_LENGTH = 20;
const CENTRAL_FLAGS = 8;
const CENTRAL_METHOD = 10;
const CENTRAL_COMPRESSED_SIZE = 20;
const CENTRAL_UNCOMPRESSED_SIZE = 24;
const CENTRAL_NAME_LENGTH = 28;
const CENTRAL_EXTRA_LENGTH = 30;
const CENTRAL_COMMENT_LENGTH = 32;
const CENTRAL_LOCAL_HEADER_OFFSET = 42;
const LOCAL_NAME_LENGTH = 26;
const LOCAL_EXTRA_LENGTH = 28;
/** General-purpose flag bit 11: the name is UTF-8, otherwise CP437 - decoded as latin1, which
 * preserves the bytes for path handling. */
const UTF8_NAME_FLAG = 1 << 11;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

export interface ZipEntry {
  /** Entry name as stored (forward-slash separated); directories end with `/`. */
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  /** Byte offset from the start of the archive. */
  readonly localHeaderOffset: number;
}

async function readAt(fh: FileHandle, offset: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buffer, 0, length, offset);
  if (bytesRead !== length) throw new Error(`zip: short read at ${offset} (${bytesRead}/${length})`);
  return buffer;
}

/** Reads the central directory of the archive behind `fh`. */
export async function readZipEntries(fh: FileHandle, fileSize: number): Promise<ZipEntry[]> {
  const span = Math.min(fileSize, EOCD_SEARCH_SPAN);
  const tail = await readAt(fh, fileSize - span, span);
  let eocd = -1;
  for (let i = span - EOCD_MIN_SIZE; i >= 0; i--) {
    // A real EOCD's comment length reaches exactly the end of the file; a stray signature inside a
    // comment or trailing garbage does not.
    if (
      tail.readUInt32LE(i) === EOCD_SIGNATURE &&
      i + EOCD_MIN_SIZE + tail.readUInt16LE(i + EOCD_COMMENT_LENGTH) === span
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('zip: no end-of-central-directory record (not a zip file?)');
  const count = tail.readUInt16LE(eocd + EOCD_ENTRY_COUNT);
  const cdSize = tail.readUInt32LE(eocd + EOCD_CD_SIZE);
  const cdOffset = tail.readUInt32LE(eocd + EOCD_CD_OFFSET);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip: ZIP64 archives are not supported');
  // Untrusted u32 fields: a directory claiming to lie past the file would drive a multi-GB alloc.
  if (cdOffset + cdSize > fileSize) throw new Error('zip: central directory lies outside the file');

  const cd = await readAt(fh, cdOffset, cdSize);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_HEADER_SIZE > cd.length || cd.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw new Error(`zip: corrupt central directory at entry ${i}`);
    }
    const flags = cd.readUInt16LE(at + CENTRAL_FLAGS);
    const method = cd.readUInt16LE(at + CENTRAL_METHOD);
    const compressedSize = cd.readUInt32LE(at + CENTRAL_COMPRESSED_SIZE);
    const size = cd.readUInt32LE(at + CENTRAL_UNCOMPRESSED_SIZE);
    const nameLength = cd.readUInt16LE(at + CENTRAL_NAME_LENGTH);
    const extraLength = cd.readUInt16LE(at + CENTRAL_EXTRA_LENGTH);
    const commentLength = cd.readUInt16LE(at + CENTRAL_COMMENT_LENGTH);
    const localHeaderOffset = cd.readUInt32LE(at + CENTRAL_LOCAL_HEADER_OFFSET);
    const name = cd
      .subarray(at + CENTRAL_HEADER_SIZE, at + CENTRAL_HEADER_SIZE + nameLength)
      .toString((flags & UTF8_NAME_FLAG) !== 0 ? 'utf8' : 'latin1');
    entries.push({ name, method, compressedSize, size, localHeaderOffset });
    at += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Reads and decompresses one entry through its local header, whose extra field can differ from the
 * central one. `fileSize` bounds the claimed compressed size and the central uncompressed size caps
 * inflate output, so a lying deflate member cannot exhaust memory.
 */
export async function readZipEntryData(
  fh: FileHandle,
  entry: ZipEntry,
  fileSize: number,
): Promise<Uint8Array> {
  const local = await readAt(fh, entry.localHeaderOffset, LOCAL_HEADER_SIZE);
  if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new Error(`zip: corrupt local header for ${entry.name}`);
  }
  const nameLength = local.readUInt16LE(LOCAL_NAME_LENGTH);
  const extraLength = local.readUInt16LE(LOCAL_EXTRA_LENGTH);
  const dataOffset = entry.localHeaderOffset + LOCAL_HEADER_SIZE + nameLength + extraLength;
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
