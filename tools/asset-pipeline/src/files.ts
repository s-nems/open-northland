import type { Stats } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function writeFileWithParents(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

/** `undefined` where `stat` would reject: an absent path, or one below a file. */
export async function statIfExists(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

/** Recursively yields every regular file under `dir`, in directory-entry order. */
export async function* walkFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}
