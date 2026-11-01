import { createExtractorFromData } from 'node-unrar-js';
import { errorMessage, MapImportError } from '../errors.js';
import type { TreeBuilder } from '../tree.js';
import type { ArchiveEntry, KeepEntry } from './entries.js';

/**
 * Unpacks the kept entries of a RAR4 or RAR5 archive with the unrar wasm build, whose binary the caller
 * supplies so the package never reads it from disk. Every kept entry's declared size is reserved from
 * the header list before anything is extracted. A passworded kept entry, encrypted headers, an entry
 * whose extracted size differs from its declared one or an archive unrar cannot read are
 * `unsupported-archive`.
 */
export async function unpackRar(
  bytes: Uint8Array,
  builder: TreeBuilder,
  keep: KeepEntry,
  wasmBinary: ArrayBuffer,
): Promise<ArchiveEntry[]> {
  try {
    // `data` must be an ArrayBuffer of exactly the archive, never a view's whole backing buffer.
    const extractor = await createExtractorFromData({ wasmBinary, data: bytes.slice().buffer });
    const { arcHeader, fileHeaders } = extractor.getFileList();
    if (arcHeader.flags.headerEncrypted)
      throw new MapImportError('unsupported-archive', 'rar: encrypted headers');
    const declared = new Map<string, number>();
    for (const header of fileHeaders) {
      builder.list();
      if (header.flags.directory || !keep(header.name, header.unpSize)) continue;
      if (header.flags.encrypted) {
        throw new MapImportError('unsupported-archive', `rar: ${header.name} is passworded`);
      }
      builder.reserve(header.name, header.unpSize);
      declared.set(header.name, header.unpSize);
    }
    if (declared.size === 0) return [];
    const entries: ArchiveEntry[] = [];
    for (const { fileHeader, extraction } of extractor.extract({ files: [...declared.keys()] }).files) {
      if (extraction === undefined) continue;
      const size = declared.get(fileHeader.name);
      if (extraction.length !== size) {
        throw new MapImportError(
          'unsupported-archive',
          `rar: ${fileHeader.name} declares ${size} bytes but holds ${extraction.length}`,
        );
      }
      entries.push({ path: fileHeader.name, bytes: extraction });
    }
    return entries;
  } catch (err) {
    if (err instanceof MapImportError) throw err;
    throw new MapImportError('unsupported-archive', `rar: ${errorMessage(err)}`);
  }
}
