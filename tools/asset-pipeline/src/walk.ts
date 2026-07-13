import { readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** Recursively yields every regular file under `dir` (absolute paths), in directory-entry order. */
export async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

/**
 * Recursively collects the `gameDir`-relative paths of every file whose last path segment is `name`
 * (case-insensitive), sorted so the resulting IR is reproducible regardless of directory-entry order.
 * The shared file-selection the map tree-walk stages use (`map.cif`, `map.dat`). `walkFiles` yields
 * native-separator paths, so one `${sep}${name}` suffix test matches on every platform.
 */
export async function collectFilesNamed(gameDir: string, name: string): Promise<string[]> {
  const suffix = `${sep}${name.toLowerCase()}`;
  const found: string[] = [];
  for await (const file of walkFiles(gameDir)) {
    if (file.toLowerCase().endsWith(suffix)) found.push(relative(gameDir, file));
  }
  found.sort();
  return found;
}
