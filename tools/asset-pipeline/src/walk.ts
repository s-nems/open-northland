import { type Vfs, vjoin } from '@open-northland/vfs';

/** Recursively yields every regular file under `dir`, in directory-entry order. */
export async function* walkFiles(fs: Vfs, dir: string): AsyncGenerator<string> {
  for (const entry of await fs.readdir(dir)) {
    const full = vjoin(dir, entry.name);
    if (entry.kind === 'dir') yield* walkFiles(fs, full);
    else yield full;
  }
}
