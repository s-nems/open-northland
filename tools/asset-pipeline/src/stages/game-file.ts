import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Small helpers shared by the loose-file extraction stages (`gui`, `fonts`) that read straight from an
 * owned game tree rather than the unpacked `.lib` output. Kept here so a stage never imports another
 * stage just for a file-read helper.
 */

/**
 * Reads a loose game file, tolerating a differently-cased leaf FILENAME (the shipped names are lower-case,
 * but a user's install could differ). Tries the exact path first, then a case-insensitive scan of the
 * parent directory for the basename — the directory components themselves must match case (they are
 * fixed-case in the shipped tree, so folding them too would be unused complexity). Throws if absent.
 */
export async function readGameFile(gameDir: string, relPath: string): Promise<Uint8Array> {
  try {
    return await readFile(join(gameDir, relPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const dir = join(gameDir, dirname(relPath));
  const want = basename(relPath).toLowerCase();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    throw new Error(`${relPath} not found under ${gameDir}`);
  }
  const match = names.find((n) => n.toLowerCase() === want);
  if (match === undefined) throw new Error(`${relPath} not found under ${gameDir}`);
  return readFile(join(dir, match));
}

/**
 * A neutral 256-colour grayscale palette (index i → (i,i,i)), used to keep a colour-LUT row stable when a
 * palette carrier is absent, so the LUT's row order (the app-side contract) stays fixed regardless of a
 * partial install.
 */
export function identityPalette(): Uint8Array {
  const p = new Uint8Array(768);
  for (let i = 0; i < 256; i++) p.fill(i, i * 3, i * 3 + 3);
  return p;
}
