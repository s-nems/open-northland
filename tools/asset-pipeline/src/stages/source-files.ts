import { readFile } from 'node:fs/promises';
import { normalizeAssetPath } from '../decoders/ini.js';
import { collectSourceFiles, resolveSourceFile, type SourceFile, type SourceRoots } from '../roots.js';

/**
 * Reads a source file, every path segment resolving case-insensitively through the pipeline's one
 * source-path rule ({@link resolveSourceFile}). Throws when absent.
 */
export async function readSourceFile(roots: SourceRoots, relPath: string): Promise<Uint8Array> {
  const path = await resolveSourceFile(roots, relPath);
  if (path === undefined) {
    throw new Error(`${relPath} not found under ${roots.mod}`);
  }
  return readFile(path);
}

/** A normalized asset reference ({@link normalizeAssetPath}) → the source file that carries it. */
export type SourceAssetIndex = ReadonlyMap<string, SourceFile>;

/** The picture and bob containers the atlas stages look up; nothing else is ever resolved by reference. */
const ATLAS_SOURCE_RE = /\.(bmd|pcx)$/;

/**
 * Indexes every `.bmd`/`.pcx` under the mod root by its normalized reference. The binding extractors
 * lower-case and forward-slash their references while the tree keeps its own spelling, so a direct
 * `join` would miss on a case-sensitive filesystem; this map bridges the two. Read the bytes from
 * `SourceFile.path`; a derived file's own path under `--out` comes from the served layout, not the
 * source spelling of `rel`. Walks the tree in full, so build it once and thread it through.
 */
export async function indexSourceAssets(roots: SourceRoots): Promise<SourceAssetIndex> {
  const index = new Map<string, SourceFile>();
  for (const file of await collectSourceFiles(roots, (rel) => ATLAS_SOURCE_RE.test(rel))) {
    index.set(normalizeAssetPath(file.rel), file);
  }
  return index;
}
