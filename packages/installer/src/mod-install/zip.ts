import type { ReadableVfs } from '@open-northland/vfs';

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
/** General-purpose flag bit 11: the name is UTF-8, otherwise CP437 - decoded byte-identically, which
 * preserves the bytes for path handling. */
const UTF8_NAME_FLAG = 1 << 11;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** Random access over an archive, so a disk file and a browser Blob read through one seam. */
export interface ZipSource {
  readonly size: number;
  /** Exactly `length` bytes at `offset`; a short read throws. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

export async function vfsZipSource(fs: ReadableVfs, path: string): Promise<ZipSource> {
  const info = await fs.stat(path);
  if (info?.kind !== 'file') throw new Error(`zip: no archive at ${path}`);
  return {
    size: info.size,
    async read(offset: number, length: number): Promise<Uint8Array> {
      const bytes = await fs.readFileSlice(path, offset, length);
      if (bytes.length !== length)
        throw new Error(`zip: short read at ${offset} (${bytes.length}/${length})`);
      return bytes;
    },
  };
}

export interface ZipEntry {
  /** Entry name as stored (forward-slash separated); directories end with `/`. */
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  /** Byte offset from the start of the archive. */
  readonly localHeaderOffset: number;
}

const utf8 = new TextDecoder();

/** Byte-identity decode for CP437-flagged names; code point = byte, so path bytes survive intact. */
function decodeByteIdentity(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function readZipEntries(source: ZipSource): Promise<ZipEntry[]> {
  const span = Math.min(source.size, EOCD_SEARCH_SPAN);
  const tail = await source.read(source.size - span, span);
  const tailView = viewOf(tail);
  let eocd = -1;
  for (let i = span - EOCD_MIN_SIZE; i >= 0; i--) {
    // A real EOCD's comment length reaches exactly the end of the file; a stray signature inside a
    // comment or trailing garbage does not.
    if (
      tailView.getUint32(i, true) === EOCD_SIGNATURE &&
      i + EOCD_MIN_SIZE + tailView.getUint16(i + EOCD_COMMENT_LENGTH, true) === span
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('zip: no end-of-central-directory record (not a zip file?)');
  const count = tailView.getUint16(eocd + EOCD_ENTRY_COUNT, true);
  const cdSize = tailView.getUint32(eocd + EOCD_CD_SIZE, true);
  const cdOffset = tailView.getUint32(eocd + EOCD_CD_OFFSET, true);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip: ZIP64 archives are not supported');
  // Untrusted u32 fields: a directory claiming to lie past the file would drive a multi-GB alloc.
  if (cdOffset + cdSize > source.size) throw new Error('zip: central directory lies outside the file');

  const cd = await source.read(cdOffset, cdSize);
  const cdView = viewOf(cd);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (at + CENTRAL_HEADER_SIZE > cd.length || cdView.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new Error(`zip: corrupt central directory at entry ${i}`);
    }
    const flags = cdView.getUint16(at + CENTRAL_FLAGS, true);
    const method = cdView.getUint16(at + CENTRAL_METHOD, true);
    const compressedSize = cdView.getUint32(at + CENTRAL_COMPRESSED_SIZE, true);
    const size = cdView.getUint32(at + CENTRAL_UNCOMPRESSED_SIZE, true);
    const nameLength = cdView.getUint16(at + CENTRAL_NAME_LENGTH, true);
    const extraLength = cdView.getUint16(at + CENTRAL_EXTRA_LENGTH, true);
    const commentLength = cdView.getUint16(at + CENTRAL_COMMENT_LENGTH, true);
    const localHeaderOffset = cdView.getUint32(at + CENTRAL_LOCAL_HEADER_OFFSET, true);
    const nameBytes = cd.subarray(at + CENTRAL_HEADER_SIZE, at + CENTRAL_HEADER_SIZE + nameLength);
    const name = (flags & UTF8_NAME_FLAG) !== 0 ? utf8.decode(nameBytes) : decodeByteIdentity(nameBytes);
    entries.push({ name, method, compressedSize, size, localHeaderOffset });
    at += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Raw-deflate decompression, refusing output beyond `maxSize` so a lying member cannot exhaust memory. */
async function inflateRawBounded(compressed: Uint8Array, maxSize: number): Promise<Uint8Array> {
  const source: ReadableStream<BufferSource> = new Blob([compressed as BlobPart]).stream();
  const reader = source.pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxSize) {
      await reader.cancel();
      throw new Error(`zip: deflate output exceeds the declared ${maxSize} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Reads and decompresses one entry through its local header, whose extra field can differ from the
 * central one. The source size bounds the claimed compressed size and the central uncompressed size
 * caps inflate output.
 */
export async function readZipEntryData(source: ZipSource, entry: ZipEntry): Promise<Uint8Array> {
  const local = await source.read(entry.localHeaderOffset, LOCAL_HEADER_SIZE);
  const localView = viewOf(local);
  if (localView.getUint32(0, true) !== LOCAL_SIGNATURE) {
    throw new Error(`zip: corrupt local header for ${entry.name}`);
  }
  const nameLength = localView.getUint16(LOCAL_NAME_LENGTH, true);
  const extraLength = localView.getUint16(LOCAL_EXTRA_LENGTH, true);
  const dataOffset = entry.localHeaderOffset + LOCAL_HEADER_SIZE + nameLength + extraLength;
  if (dataOffset + entry.compressedSize > source.size) {
    throw new Error(`zip: entry ${entry.name} lies outside the file`);
  }
  const compressed = await source.read(dataOffset, entry.compressedSize);
  if (entry.method === METHOD_STORED) return compressed;
  if (entry.method === METHOD_DEFLATE) return inflateRawBounded(compressed, entry.size);
  throw new Error(`zip: unsupported compression method ${entry.method} for ${entry.name}`);
}
