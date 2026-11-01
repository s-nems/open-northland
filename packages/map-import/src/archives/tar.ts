import { MapImportError } from '../errors.js';
import type { TreeBuilder } from '../tree.js';
import type { ArchiveEntry, KeepEntry } from './entries.js';

/** A tar archive is a run of 512-byte blocks: a header, then the entry's data padded to whole blocks. */
const BLOCK_BYTES = 512;
/** Header field offsets and widths (POSIX.1-1988 ustar). */
const NAME_OFFSET = 0;
const NAME_BYTES = 100;
const SIZE_OFFSET = 124;
const SIZE_BYTES = 12;
const CHECKSUM_OFFSET = 148;
const CHECKSUM_BYTES = 8;
const TYPEFLAG_OFFSET = 156;
const MAGIC_OFFSET = 257;
const PREFIX_OFFSET = 345;
const PREFIX_BYTES = 155;
/** POSIX writes `ustar\0` then version `00`; GNU writes `ustar  \0` and keeps other fields at 345. */
const POSIX_MAGIC = 'ustar\u000000';
const USTAR = 'ustar';
const OCTAL_RADIX = 8;
const SPACE = 0x20;
const NUL = 0;
/** Regular file type flags: `'0'`, or NUL from pre-POSIX writers. Every other type is skipped. */
const TYPE_FILE = 0x30;
const TYPE_FILE_OLD = NUL;

function fail(detail: string): never {
  throw new MapImportError('unsupported-archive', `tar: ${detail}`);
}

/** Whether `bytes` carry the ustar magic, POSIX or GNU, where a tar header puts it. */
export function isTar(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC_OFFSET + USTAR.length) return false;
  return ascii(bytes, MAGIC_OFFSET, USTAR.length) === USTAR;
}

function ascii(bytes: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(at, at + length));
}

/** A NUL-terminated name field; UTF-8 when it decodes as such, else one byte per character. */
function text(header: Uint8Array, at: number, length: number): string {
  const field = header.subarray(at, at + length);
  const end = field.indexOf(NUL);
  const raw = end < 0 ? field : field.subarray(0, end);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    return String.fromCharCode(...raw);
  }
}

/** An octal number field, padded with spaces or NULs. GNU's base-256 sizes are refused. */
function octal(header: Uint8Array, at: number, length: number, field: string): number {
  const digits = ascii(header, at, length).replace(/^[\0 ]+|[\0 ]+$/g, '');
  if (!/^[0-7]*$/.test(digits)) fail(`${field} field "${digits}" is not octal`);
  return digits === '' ? 0 : Number.parseInt(digits, OCTAL_RADIX);
}

/** The header's byte sum with its checksum field counted as spaces. */
function checksum(header: Uint8Array): number {
  let sum = SPACE * CHECKSUM_BYTES;
  header.forEach((byte, i) => {
    if (i < CHECKSUM_OFFSET || i >= CHECKSUM_OFFSET + CHECKSUM_BYTES) sum += byte;
  });
  return sum;
}

function entryPath(header: Uint8Array): string {
  const name = text(header, NAME_OFFSET, NAME_BYTES);
  if (ascii(header, MAGIC_OFFSET, POSIX_MAGIC.length) !== POSIX_MAGIC) return name;
  const prefix = text(header, PREFIX_OFFSET, PREFIX_BYTES);
  return prefix === '' ? name : `${prefix}/${name}`;
}

/**
 * Unpacks the kept regular files of a plain ustar archive. Directories, links, GNU long-name and pax
 * records are skipped with their data, so a name longer than the 100-byte field plus 155-byte prefix
 * is lost. A zero block or the end of the bytes ends the archive; a bad header checksum or an entry
 * running past the bytes is `unsupported-archive`.
 */
export async function unpackTar(
  bytes: Uint8Array,
  builder: TreeBuilder,
  keep: KeepEntry,
): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  let at = 0;
  while (at < bytes.length) {
    if (at + BLOCK_BYTES > bytes.length) fail(`header at ${at} is cut short`);
    const header = bytes.subarray(at, at + BLOCK_BYTES);
    if (header.every((byte) => byte === NUL)) break;
    if (octal(header, CHECKSUM_OFFSET, CHECKSUM_BYTES, 'checksum') !== checksum(header)) {
      fail(`header at ${at} fails its checksum`);
    }
    const size = octal(header, SIZE_OFFSET, SIZE_BYTES, 'size');
    const start = at + BLOCK_BYTES;
    const path = entryPath(header);
    if (start + size > bytes.length) fail(`${path} declares ${size} bytes past the end`);
    builder.list();
    const type = header[TYPEFLAG_OFFSET];
    if ((type === TYPE_FILE || type === TYPE_FILE_OLD) && keep(path, size)) {
      builder.reserve(path, size);
      entries.push({ path, bytes: bytes.subarray(start, start + size) });
    }
    at = start + Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES;
  }
  return entries;
}
