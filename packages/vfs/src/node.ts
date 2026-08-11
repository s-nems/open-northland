import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Vfs, VfsEntry, VfsStat } from './types.js';

/** Follows symlinks, so a linked entry is classified by what it points at. */
async function statAt(path: string): Promise<VfsStat | undefined> {
  try {
    const info = await stat(path);
    if (info.isFile()) return { kind: 'file', size: info.size };
    if (info.isDirectory()) return { kind: 'dir', size: 0 };
    return undefined;
  } catch {
    return undefined;
  }
}

/** Passes paths straight to `node:fs`, so callers hand it native absolute roots. */
export function nodeVfs(): Vfs {
  return {
    readFile(path: string): Promise<Uint8Array> {
      return readFile(path);
    },

    async readFileSlice(path: string, offset: number, length: number): Promise<Uint8Array> {
      const handle = await open(path, 'r');
      try {
        const buffer = new Uint8Array(length);
        // One read may return short of the request; keep reading until the range or EOF is reached.
        let filled = 0;
        while (filled < length) {
          const { bytesRead } = await handle.read(buffer, filled, length - filled, offset + filled);
          if (bytesRead === 0) break;
          filled += bytesRead;
        }
        return buffer.subarray(0, filled);
      } finally {
        await handle.close();
      }
    },

    async writeFile(path: string, data: Uint8Array): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },

    async mkdir(path: string): Promise<void> {
      await mkdir(path, { recursive: true });
    },

    async readdir(path: string): Promise<VfsEntry[]> {
      const entries = await readdir(path, { withFileTypes: true });
      const classified = await Promise.all(
        entries.map(async (entry): Promise<VfsEntry | undefined> => {
          if (entry.isFile()) return { name: entry.name, kind: 'file' };
          if (entry.isDirectory()) return { name: entry.name, kind: 'dir' };
          if (!entry.isSymbolicLink()) return undefined;
          const target = await statAt(join(path, entry.name));
          return target === undefined ? undefined : { name: entry.name, kind: target.kind };
        }),
      );
      return classified.filter((entry) => entry !== undefined);
    },

    stat: statAt,

    async rm(path: string): Promise<void> {
      await rm(path, { recursive: true, force: true });
    },
  };
}
