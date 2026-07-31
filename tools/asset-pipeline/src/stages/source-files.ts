import { readFile } from 'node:fs/promises';
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
export async function readSourceFile(roots: SourceRoots, relPath: string): Promise<Uint8Array> {
  const path = await resolveSourceFile(roots, relPath);
  if (path === undefined) {
    throw new Error(`${relPath} not found under ${rootsInOrder(roots).join(' or ')}`);
  }
  return readFile(path);
}

/** A normalized asset reference ({@link normalizeAssetPath}) → the layer copy that wins it. */
export type SourceAssetIndex = ReadonlyMap<string, SourceFile>;

/** The picture and bob containers the atlas stages look up; nothing else is ever resolved by reference. */
const ATLAS_SOURCE_RE = /\.(bmd|pcx)$/;

/**
 * Indexes every `.bmd`/`.pcx` across the layers by its normalized reference. The binding extractors
 * lower-case and forward-slash their references while each layer keeps its own spelling, so a direct
 * `join` would miss on a case-sensitive filesystem; this map bridges the two. Read the bytes from
 * `SourceFile.path` (the winning layer) and write derived files beside `SourceFile.rel` under `--out`.
 *
 * Built once after the unpack stage and threaded into every consumer — it walks every layer in full,
 * which no per-lookup resolution could afford.
 */
export async function indexSourceAssets(roots: SourceRoots): Promise<SourceAssetIndex> {
  const index = new Map<string, SourceFile>();
  for (const file of await collectSourceFiles(roots, (rel) => ATLAS_SOURCE_RE.test(rel))) {
    index.set(normalizeAssetPath(file.rel), file);
  }
  return index;
}
