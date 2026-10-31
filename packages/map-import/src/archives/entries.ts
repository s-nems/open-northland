import { isC2m } from '@open-northland/formats/c2m';
import { MapImportError } from '../errors.js';
import type { ImportLimits } from '../limits.js';
import { isMapTreePath, normalizePath, type TreeBuilder } from '../tree.js';
import { isNsisInstaller } from './nsis.js';
import { isTar } from './tar.js';

/** One kept archive entry: a map file, or a nested archive to open in place. */
export interface ArchiveEntry {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Lists an archive, keeping the entries `keep` accepts; counts and sizes go through `builder`. */
export type Unpack = (
  bytes: Uint8Array,
  builder: TreeBuilder,
  keep: (path: string) => boolean,
) => Promise<ArchiveEntry[]>;

/** The archive formats an import opens, told apart by their leading bytes (a tar by its ustar magic). */
export type ArchiveFormat = 'zip' | 'rar' | 'c2m' | 'tar' | 'nsis';

const NESTED_EXTENSIONS: Readonly<Record<string, ArchiveFormat>> = {
  '.zip': 'zip',
  '.rar': 'rar',
  '.c2m': 'c2m',
  '.tar': 'tar',
  '.exe': 'nsis',
};

const ZIP_MAGIC = [0x50, 0x4b] as const;
const RAR_MAGIC = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07] as const;

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((byte, i) => bytes[i] === byte);
}

/** The archive format `bytes` open with, or undefined when none matches. */
export function detectArchiveFormat(bytes: Uint8Array): ArchiveFormat | undefined {
  if (startsWith(bytes, ZIP_MAGIC)) return 'zip';
  if (startsWith(bytes, RAR_MAGIC)) return 'rar';
  if (isC2m(bytes)) return 'c2m';
  if (isTar(bytes)) return 'tar';
  if (isNsisInstaller(bytes)) return 'nsis';
  return undefined;
}

/** The format a nested entry's extension names, or undefined for a plain file. */
function nestedFormat(path: string): ArchiveFormat | undefined {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? undefined : NESTED_EXTENSIONS[path.slice(dot).toLowerCase()];
}

/**
 * Fills `builder` from one archive under `prefix`. A nested archive opens one level deep, under its
 * own path without the extension, so `pack/foo.c2m` lands as `pack/foo/…`; deeper archives are ignored.
 */
export async function fillTree(
  bytes: Uint8Array,
  format: ArchiveFormat,
  builder: TreeBuilder,
  unpackers: (format: ArchiveFormat) => Unpack,
  prefix = '',
  nested = false,
): Promise<void> {
  const keep = (path: string): boolean =>
    isMapTreePath(path) || (!nested && nestedFormat(path) !== undefined);
  const entries = await unpackers(format)(bytes, builder, keep);
  for (const entry of entries) {
    const path = prefix === '' ? normalizePath(entry.path) : `${prefix}/${normalizePath(entry.path)}`;
    const inner = nested ? undefined : nestedFormat(path);
    if (inner === undefined) {
      builder.add(path, entry.bytes);
    } else {
      // The leading bytes win over a mislabelled extension, and an `.exe` is NSIS only when they say so.
      const format = detectArchiveFormat(entry.bytes) ?? (inner === 'nsis' ? undefined : inner);
      if (format === undefined) {
        if (inner !== 'nsis') builder.add(path, entry.bytes);
      } else
        await fillTree(entry.bytes, format, builder, unpackers, path.slice(0, path.lastIndexOf('.')), true);
    }
  }
}

/** Throws `too-large` for an archive over the byte budget, before anything unpacks. */
export function assertArchiveSize(bytes: Uint8Array, limits: ImportLimits, source: string): void {
  if (bytes.length > limits.archiveBytes) {
    throw new MapImportError(
      'too-large',
      `${source}: ${bytes.length} bytes, over the ${limits.archiveBytes}-byte archive limit`,
    );
  }
}
