import { type Vfs, vjoin } from '@open-northland/vfs';
import { collectSourceFiles, type SourceRoots } from '../roots.js';
import { SOUNDS_DIR, servedRelPath } from './content-tree.js';

const SOUNDS_SOURCE_PREFIX = `${SOUNDS_DIR.toLowerCase()}/`;

/**
 * Copies the mod's loose `.wav` tree into the served sounds subtree. The IR references each wav
 * lower-cased relative to that tree, so every copy lands at the route's spelling.
 */
export async function copySoundTree(fs: Vfs, roots: SourceRoots, outDir: string): Promise<string[]> {
  const copied: string[] = [];
  const wavs = await collectSourceFiles(
    fs,
    roots,
    (rel) => rel.startsWith(SOUNDS_SOURCE_PREFIX) && rel.endsWith('.wav'),
  );
  for (const { rel, path } of wavs) {
    const target = servedRelPath(rel);
    await fs.writeFile(vjoin(outDir, target), await fs.readFile(path));
    copied.push(target);
  }
  return copied;
}
