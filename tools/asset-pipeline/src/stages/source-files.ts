import type { ReadableVfs } from '@open-northland/vfs';
import { normalizeAssetPath } from '../decoders/ini.js';
import {
  collectSourceFiles,
  resolveSourceFile,
  rootsInOrder,
  type SourceFile,
  type SourceRoots,
} from '../roots.js';

/**
 * Reads a source file layer-first, every path segment resolving case-insensitively through the
 * pipeline's one source-path rule ({@link resolveSourceFile}). Throws when absent in every root.
 */
export async function readSourceFile(
  fs: ReadableVfs,
  roots: SourceRoots,
  relPath: string,
): Promise<Uint8Array> {
  const path = await resolveSourceFile(fs, roots, relPath);
  if (path === undefined) {
    throw new Error(`${relPath} not found under ${rootsInOrder(roots).join(' or ')}`);
  }
  return fs.readFile(path);
}

/** A normalized asset reference ({@link normalizeAssetPath}) → the layer copy that wins it. */
export type SourceAssetIndex = ReadonlyMap<string, SourceFile>;

/** The picture and bob containers the atlas stages look up; nothing else is ever resolved by reference. */
const ATLAS_SOURCE_RE = /\.(bmd|pcx)$/;

/**
 * Indexes every `.bmd`/`.pcx` across the layers by its normalized reference. The binding extractors
 * lower-case and forward-slash their references while each layer keeps its own spelling, so a direct
 * `join` would miss on a case-sensitive filesystem; this map bridges the two. Read the bytes from
 * `SourceFile.path`; a derived file's own path under `--out` comes from the served layout, not the
 * layer's spelling of `rel`. Walks every layer in full, so build it once and thread it through.
 */
export async function indexSourceAssets(fs: ReadableVfs, roots: SourceRoots): Promise<SourceAssetIndex> {
  const index = new Map<string, SourceFile>();
  for (const file of await collectSourceFiles(fs, roots, (rel) => ATLAS_SOURCE_RE.test(rel))) {
    index.set(normalizeAssetPath(file.rel), file);
  }
  return index;
}
