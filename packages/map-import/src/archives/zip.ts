import { errorMessage, MapImportError } from '../errors.js';
import type { TreeBuilder } from '../tree.js';
import type { ArchiveEntry, KeepEntry } from './entries.js';
import { inflateBounded } from './inflate.js';

/** End-of-central-directory, ZIP64 locator and central-header signatures (APPNOTE 4.3.16, 4.3.15, 4.3.12). */
const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_BYTES = 22;
/** The ZIP64 locator sits directly before the end-of-central-directory record. */
const ZIP64_LOCATOR_BYTES = 20;
const MAX_COMMENT_BYTES = 0xffff;
const CENTRAL_HEADER_BYTES = 46;
/** Field offsets inside the end-of-central-directory record and a central header. */
const EOCD_ENTRY_COUNT = 10;
const EOCD_DIRECTORY_OFFSET = 16;
const CENTRAL_FLAGS = 8;
const CENTRAL_COMPRESSED_SIZE = 20;
const CENTRAL_UNCOMPRESSED_SIZE = 24;
const CENTRAL_LOCAL_OFFSET = 42;
const CENTRAL_NAME_LENGTH = 28;
const CENTRAL_EXTRA_LENGTH = 30;
const CENTRAL_COMMENT_LENGTH = 32;
/** General-purpose flag bit 0: the entry is encrypted; bit 11: its name is UTF-8, else CP437. */
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
/** The 32- and 16-bit field values that defer to a ZIP64 record. */
const ZIP64_DEFERRED = 0xffffffff;
const ZIP64_DEFERRED_COUNT = 0xffff;

function rejectZip64(): never {
  throw new MapImportError('unsupported-archive', 'zip: ZIP64 archives are not supported');
}

interface ZipEntry {
  readonly path: string;
  readonly size: number;
  readonly compressed: Uint8Array;
  readonly method: number;
}

function readEntries(bytes: Uint8Array, builder: TreeBuilder, keep: KeepEntry): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  const spans: { start: number; end: number }[] = [];
  const floor = Math.max(0, bytes.length - EOCD_BYTES - MAX_COMMENT_BYTES);
  let eocd = -1;
  for (let at = bytes.length - EOCD_BYTES; at >= floor; at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) throw new Error('missing central directory');
  const locator = eocd - ZIP64_LOCATOR_BYTES;
  if (locator >= 0 && view.getUint32(locator, true) === ZIP64_LOCATOR_SIGNATURE) rejectZip64();
  const count = view.getUint16(eocd + EOCD_ENTRY_COUNT, true);
  let at = view.getUint32(eocd + EOCD_DIRECTORY_OFFSET, true);
  if (count === ZIP64_DEFERRED_COUNT || at === ZIP64_DEFERRED) rejectZip64();
  for (let i = 0; i < count; i++) {
    builder.list();
    if (at + CENTRAL_HEADER_BYTES > bytes.length || view.getUint32(at, true) !== CENTRAL_SIGNATURE)
      throw new Error('invalid central directory');
    const flags = view.getUint16(at + CENTRAL_FLAGS, true);
    const deferred = [CENTRAL_COMPRESSED_SIZE, CENTRAL_UNCOMPRESSED_SIZE, CENTRAL_LOCAL_OFFSET].some(
      (field) => view.getUint32(at + field, true) === ZIP64_DEFERRED,
    );
    if (deferred) rejectZip64();
    const nameLength = view.getUint16(at + CENTRAL_NAME_LENGTH, true);
    const extraLength = view.getUint16(at + CENTRAL_EXTRA_LENGTH, true);
    const commentLength = view.getUint16(at + CENTRAL_COMMENT_LENGTH, true);
    const end = at + CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
    if (end > bytes.length) throw new Error('truncated central directory');
    const nameBytes = bytes.subarray(at + CENTRAL_HEADER_BYTES, at + CENTRAL_HEADER_BYTES + nameLength);
    const path =
      (flags & FLAG_UTF8) !== 0 ? new TextDecoder().decode(nameBytes) : String.fromCharCode(...nameBytes);
    const size = view.getUint32(at + CENTRAL_UNCOMPRESSED_SIZE, true);
    if (!path.endsWith('/') && keep(path, size)) {
      if ((flags & FLAG_ENCRYPTED) !== 0) throw new Error(`${path} is encrypted`);
      if (names.has(path)) throw new Error(`duplicate entry ${path}`);
      names.add(path);
      builder.reserve(path, size);
      const local = view.getUint32(at + CENTRAL_LOCAL_OFFSET, true);
      if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50)
        throw new Error('invalid local header');
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const finish = start + view.getUint32(at + CENTRAL_COMPRESSED_SIZE, true);
      if (finish > bytes.length) throw new Error('truncated entry');
      const method = view.getUint16(at + 10, true);
      if (method !== 0 && method !== 8) throw new Error(`unsupported compression ${method}`);
      if (finish > start) spans.push({ start, end: finish });
      entries.push({ path, size, compressed: bytes.subarray(start, finish), method });
    }
    at += CENTRAL_HEADER_BYTES + nameLength + extraLength + commentLength;
  }
  spans.sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    const previous = spans[i - 1];
    const current = spans[i];
    if (previous !== undefined && current !== undefined && current.start < previous.end)
      throw new Error('overlapping compressed entries');
  }
  return entries;
}

function inflateEntry(entry: ZipEntry): Uint8Array {
  if (entry.method === 0) {
    if (entry.compressed.length !== entry.size) throw new Error(`${entry.path}: size mismatch`);
    return entry.compressed.slice();
  }
  const output = new Uint8Array(entry.size);
  let written = 0;
  inflateBounded(entry.compressed, entry.path, (chunk) => {
    if (written + chunk.length > entry.size)
      throw new Error(`${entry.path}: inflated size exceeds declaration`);
    output.set(chunk, written);
    written += chunk.length;
  });
  if (written !== entry.size) throw new Error(`${entry.path}: inflated size differs from declaration`);
  return output;
}

/** Reserves the entire selected directory before inflation, then bounds actual output while decoding. */
export async function unpackZip(
  bytes: Uint8Array,
  builder: TreeBuilder,
  keep: KeepEntry,
): Promise<ArchiveEntry[]> {
  try {
    return readEntries(bytes, builder, keep).map((entry) => ({
      path: entry.path,
      bytes: inflateEntry(entry),
    }));
  } catch (err) {
    if (err instanceof MapImportError) throw err;
    throw new MapImportError('unsupported-archive', `zip: ${errorMessage(err)}`);
  }
}
