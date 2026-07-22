import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { rootsInOrder, type SourceRoots } from '../roots.js';

/**
 * Reads a loose source file overlay-first ({@link SourceRoots}), tolerating a differently-cased leaf
 * filename per root (the shipped names are lower-case, but a user's install could differ): the exact
 * path is tried first, then a case-insensitive scan of the parent directory for the basename — the
 * directory components themselves must match case (they are fixed-case in the shipped tree, so
 * folding them too would be unused complexity). Throws when absent in every root.
 */
export async function readSourceFile(roots: SourceRoots, relPath: string): Promise<Uint8Array> {
  const order = rootsInOrder(roots);
  for (const root of order) {
    const bytes = await readLooseFile(root, relPath);
    if (bytes !== undefined) return bytes;
  }
  throw new Error(`${relPath} not found under ${order.join(' or ')}`);
}

/** One root's leaf-case-tolerant read; undefined when the file is absent there. */
async function readLooseFile(root: string, relPath: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(join(root, relPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const dir = join(root, dirname(relPath));
  const want = basename(relPath).toLowerCase();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  const match = names.find((n) => n.toLowerCase() === want);
  if (match === undefined) return undefined;
  return readFile(join(dir, match));
}
