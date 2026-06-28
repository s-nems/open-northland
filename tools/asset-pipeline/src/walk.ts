import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Recursively yields every regular file under `dir` (absolute paths), in directory-entry order. */
export async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}
