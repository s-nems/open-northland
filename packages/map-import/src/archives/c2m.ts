import { decodeC2m } from '@open-northland/formats/c2m';
import { DecodeLimitError } from '@open-northland/formats/limit';
import { errorMessage, MapImportError } from '../errors.js';
import { normalizePath, type TreeBuilder } from '../tree.js';
import type { ArchiveEntry, KeepEntry } from './entries.js';

/** The folder the map editor exports into; dropped so the map sits at the export's own root. */
const C2M_EXPORT_ROOT = 'currentusermap';

/** Unpacks the kept files of a `.c2m`. A corrupt directory is `unsupported-archive`. */
export async function unpackC2m(
  bytes: Uint8Array,
  builder: TreeBuilder,
  keep: KeepEntry,
): Promise<ArchiveEntry[]> {
  let files: ReturnType<typeof decodeC2m>;
  try {
    files = decodeC2m(bytes, builder.remainingEntries);
  } catch (err) {
    if (err instanceof DecodeLimitError) throw new MapImportError('too-large', err.message);
    throw new MapImportError('unsupported-archive', errorMessage(err));
  }
  builder.list(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true));
  const paths = files.map((file) => normalizePath(file.name));
  const rooted = paths.every((path) => path.toLowerCase().startsWith(`${C2M_EXPORT_ROOT}/`));
  const entries: ArchiveEntry[] = [];
  files.forEach((file, i) => {
    builder.list();
    const path = rooted ? (paths[i] ?? '').slice(C2M_EXPORT_ROOT.length + 1) : (paths[i] ?? '');
    if (!keep(path, file.bytes.length)) return;
    builder.reserve(path, file.bytes.length);
    entries.push({ path, bytes: file.bytes });
  });
  return entries;
}
