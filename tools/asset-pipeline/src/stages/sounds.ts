import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileWithParents } from '../files.js';
import { collectSourceFiles, MOD_SOUNDS_DIR, type SourceRoots } from '../roots.js';
import { SOUNDS_DIR } from './content-tree.js';

const SOUNDS_SOURCE_PREFIX = `${MOD_SOUNDS_DIR.toLowerCase()}/`;

/** Copies the mod's loose `.wav` tree into `sounds/`, lower-cased the way the IR references each file. */
export async function copySoundTree(roots: SourceRoots, outDir: string): Promise<string[]> {
  const copied: string[] = [];
  const wavs = await collectSourceFiles(
    roots,
    (rel) => rel.startsWith(SOUNDS_SOURCE_PREFIX) && rel.endsWith('.wav'),
  );
  for (const { rel, path } of wavs) {
    const target = `${SOUNDS_DIR}/${rel.toLowerCase().slice(SOUNDS_SOURCE_PREFIX.length)}`;
    await writeFileWithParents(join(outDir, target), await readFile(path));
    copied.push(target);
  }
  return copied;
}
