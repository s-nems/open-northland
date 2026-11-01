import { C2M_VERSION, decodeC2m } from '@open-northland/formats/c2m';
import { DecodeLimitError } from '@open-northland/formats/limit';
import { errorMessage, MapImportError } from '../errors.js';
import { normalizePath, type TreeBuilder } from '../tree.js';
import type { ArchiveEntry } from './entries.js';

/** The folder the map editor exports into; dropped so the map sits at the export's own root. */
const C2M_EXPORT_ROOT = 'currentusermap';
/** The most zero padding a cut-off file's directory may ask for; beyond that the damage is the
 *  directory itself, not a tail, and padding would invent more file than a map ever lost. */
const MAX_PADDING_BYTES = 1024 * 1024;

/**
 * The byte length a `.c2m`'s directory promises, or null when its directory is not readable. Walks
 * the records the way `decodeC2m` does, without decoding: the length a damaged file's last blob
 * would need to keep every offset and size the directory states.
 */
function promisedLength(bytes: Uint8Array): number | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number): number => view.getUint32(at, true);
  if (u32(0) !== C2M_VERSION) return null;
  const dirCount = u32(4);
  const fileCount = u32(8);
  if ((dirCount + fileCount) * 8 > bytes.length) return null;
  let at = 12;
  for (let i = 0; i < dirCount; i++) {
    if (at + 8 > bytes.length) return null;
    at += 4 + u32(at);
    if (at + 4 > bytes.length || u32(at) !== i) return null;
    at += 4;
  }
  let needed = 0;
  for (let i = 0; i < fileCount; i++) {
    if (at + 12 > bytes.length) return null;
    at += 4 + u32(at);
    if (at + 8 > bytes.length) return null;
    needed = Math.max(needed, u32(at) + u32(at + 4));
    at += 8;
  }
  return needed;
}

/** Unpacks the kept files of a `.c2m`. A corrupt directory is `unsupported-archive`. */
export async function unpackC2m(
  bytes: Uint8Array,
  builder: TreeBuilder,
  keep: (path: string) => boolean,
): Promise<ArchiveEntry[]> {
  let files: ReturnType<typeof decodeC2m>;
  try {
    files = decodeC2m(bytes, builder.remainingEntries);
  } catch (err) {
    if (err instanceof DecodeLimitError) throw new MapImportError('too-large', err.message);
    // A file cut off mid-blob still names its full size: pad the missing tail with zeros so the
    // intact blobs open, and let the zeroed file's own decoder refuse it.
    const promised = promisedLength(bytes);
    if (promised === null || promised < bytes.length || promised - bytes.length > MAX_PADDING_BYTES)
      throw new MapImportError('unsupported-archive', errorMessage(err));
    const padded = new Uint8Array(promised);
    padded.set(bytes);
    try {
      files = decodeC2m(padded, builder.remainingEntries);
    } catch (retry) {
      if (retry instanceof DecodeLimitError) throw new MapImportError('too-large', retry.message);
      throw new MapImportError('unsupported-archive', errorMessage(retry));
    }
  }
  builder.list(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true));
  const paths = files.map((file) => normalizePath(file.name));
  const rooted = paths.every((path) => path.toLowerCase().startsWith(`${C2M_EXPORT_ROOT}/`));
  const entries: ArchiveEntry[] = [];
  files.forEach((file, i) => {
    builder.list();
    const path = rooted ? (paths[i] ?? '').slice(C2M_EXPORT_ROOT.length + 1) : (paths[i] ?? '');
    if (!keep(path)) return;
    builder.reserve(path, file.bytes.length);
    entries.push({ path, bytes: file.bytes });
  });
  return entries;
}
