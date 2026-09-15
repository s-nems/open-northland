import { type Vfs, vjoin } from '@open-northland/vfs';
import { collectSourceFiles, MOD_SOUNDS_DIR, type SourceRoots } from '../roots.js';
import { SOUNDS_DIR } from './content-tree.js';

const SOUNDS_SOURCE_PREFIX = `${MOD_SOUNDS_DIR.toLowerCase()}/`;

/** Copies the mod's loose `.wav` tree into `sounds/`, lower-cased the way the IR references each file. */
export async function copySoundTree(fs: Vfs, roots: SourceRoots, outDir: string): Promise<string[]> {
  const copied: string[] = [];
  const wavs = await collectSourceFiles(
    fs,
    roots,
    (rel) => rel.startsWith(SOUNDS_SOURCE_PREFIX) && rel.endsWith('.wav'),
  );
  for (const { rel, path } of wavs) {
    const target = vjoin(SOUNDS_DIR, rel.toLowerCase().slice(SOUNDS_SOURCE_PREFIX.length));
    await fs.writeFile(vjoin(outDir, target), await fs.readFile(path));
    copied.push(target);
  }
  return copied;
}
