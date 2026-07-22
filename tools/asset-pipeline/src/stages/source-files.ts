import { readFile } from 'node:fs/promises';
import { resolveSourceFile, rootsInOrder, type SourceRoots } from '../roots.js';

/**
 * Reads a loose source file overlay-first, every path segment resolving case-insensitively through
 * the pipeline's one source-path rule ({@link resolveSourceFile}). Throws when absent in every root.
 */
export async function readSourceFile(roots: SourceRoots, relPath: string): Promise<Uint8Array> {
  const path = await resolveSourceFile(roots, relPath);
  if (path === undefined) {
    throw new Error(`${relPath} not found under ${rootsInOrder(roots).join(' or ')}`);
  }
  return readFile(path);
}
